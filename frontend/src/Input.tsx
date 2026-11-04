import { splitProps, type JSX } from 'solid-js';
import './Input.css';

export default function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ['class', 'type']);
  return <input {...rest} type={local.type ?? 'text'} class={`text-input${local.class ? ` ${local.class}` : ''}`} />;
}
