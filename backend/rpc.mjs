import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

/** One explicitly started agent, shared by local browser tabs. */
export class PiRpc extends EventEmitter {
  pending = new Map();
  child = null;
  generating = false;
  compacting = false;
  get running() { return this.generating || this.compacting; }
  stderr = '';
  async start(command, args, cwd) {
    if (this.child) throw new Error('Pi is already connected');
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        let record;
        try { record = JSON.parse(line); }
        catch { this.emit('diagnostic', 'Invalid JSON received from Pi'); continue; }
        if (record.type === 'response') {
          const request = this.pending.get(record.id);
          if (request) {
            this.pending.delete(record.id);
            if (record.success) request.resolve(record.data);
            else request.reject(new Error(record.error || 'Pi command failed'));
          }
        } else {
          if (record.type === 'agent_start') this.generating = true;
          if (record.type === 'agent_settled') this.generating = false;
          if (record.type === 'compaction_start') this.compacting = true;
          if (record.type === 'compaction_end') this.compacting = false;
          this.emit('record', record);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-8000); this.emit('diagnostic', chunk); });
    const fail = error => {
      if (this.child !== child) return;
      this.child = null; this.generating = false; this.compacting = false;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.emit('exit', error.message);
    };
    child.on('error', fail);
    child.on('exit', (code, signal) => fail(new Error(`Pi exited (${signal || code}). ${this.stderr.slice(-1000)}`)));
    return this.command({ type: 'get_state' });
  }
  command(record) {
    if (!this.child) return Promise.reject(new Error('Start Pi first'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ ...record, id }).catch(error => {
        this.pending.delete(id); reject(error);
      });
    });
  }
  async write(record) {
    const input = this.child?.stdin;
    if (!input || input.destroyed) throw new Error('Pi is disconnected');
    // The write callback waits until this chunk has been flushed, honoring backpressure.
    await new Promise((resolve, reject) => input.write(JSON.stringify(record) + '\n', error => error ? reject(error) : resolve()));
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    await new Promise(resolve => {
      child.once('exit', resolve);
      child.stdin.end();
      child.kill('SIGTERM');
    });
  }
}
