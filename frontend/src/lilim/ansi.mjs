// Parse terminal SGR into data. Solid owns the resulting text and style elements.
const colors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const palette = [...colors, ...colors.map(color => `bright-${color}`)].map(color => `var(--ansi-${color})`);
// Terminal controls are the input this tokenizer is specifically designed to parse.
// eslint-disable-next-line no-control-regex
const control = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[()][0-2A-Z]|\x1b[@-_]/g;

function indexed(n) {
  if (n < 16) return palette[n];
  if (n < 232) {
    const levels = [0, 95, 135, 175, 215, 255];
    const value = n - 16;
    return `rgb(${levels[Math.floor(value / 36)]}, ${levels[Math.floor(value / 6) % 6]}, ${levels[value % 6]})`;
  }

  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

export function createAnsiTokenizer() {
  let state = {};

  function sgr(sequence) {
    const values = sequence.slice(2, -1).replace(/:2::/g, ';2;').replaceAll(':', ';').split(';').map(value => Number(value || 0));
    for (let i = 0; i < values.length; i++) {
      const n = values[i];
      if (n === 0) state = {};
      else if (n === 1) state.bold = true;
      else if (n === 2) state.dim = true;
      else if (n === 3) state.italic = true;
      else if (n === 4) state.underline = true;
      else if (n === 7) state.inverse = true;
      else if (n === 8) state.conceal = true;
      else if (n === 9) state.strike = true;
      else if (n === 22) { delete state.bold; delete state.dim; }
      else if (n === 23) delete state.italic;
      else if (n === 24) delete state.underline;
      else if (n === 27) delete state.inverse;
      else if (n === 28) delete state.conceal;
      else if (n === 29) delete state.strike;
      else if (n >= 30 && n <= 37) state.fg = palette[n - 30];
      else if (n >= 40 && n <= 47) state.bg = palette[n - 40];
      else if (n >= 90 && n <= 97) state.fg = palette[n - 90 + 8];
      else if (n >= 100 && n <= 107) state.bg = palette[n - 100 + 8];
      else if (n === 39) delete state.fg;
      else if (n === 49) delete state.bg;
      else if (n === 38 || n === 48) {
        const key = n === 38 ? 'fg' : 'bg';
        if (values[i + 1] === 5 && values[i + 2] !== undefined) {
          state[key] = indexed(Math.max(0, Math.min(255, values[i + 2])));
          i += 2;
        } else if (values[i + 1] === 2 && values.length > i + 4) {
          state[key] = `rgb(${values.slice(i + 2, i + 5).map(value => Math.max(0, Math.min(255, value))).join(', ')})`;
          i += 4;
        }
      }
    }
  }

  return value => {
    const runs = [];
    const append = text => {
      if (!text) return;

      const style = {};
      const fg = state.inverse ? state.bg || 'var(--background)' : state.fg;
      const bg = state.inverse ? state.fg || 'var(--text)' : state.bg;
      if (fg) style.color = fg;
      if (bg) style['background-color'] = bg;
      if (state.bold) style['font-weight'] = '700';
      if (state.dim) style.opacity = '.6';
      if (state.italic) style['font-style'] = 'italic';
      if (state.conceal) style.visibility = 'hidden';

      const decorations = [state.underline && 'underline', state.strike && 'line-through'].filter(Boolean);
      if (decorations.length) style['text-decoration'] = decorations.join(' ');
      runs.push({ text, style });
    };

    let offset = 0;
    for (const match of value.matchAll(control)) {
      append(value.slice(offset, match.index));
      if (match[0].startsWith('\x1b[') && match[0].endsWith('m')) sgr(match[0]);
      offset = match.index + match[0].length;
    }
    append(value.slice(offset));

    return runs;
  };
}
