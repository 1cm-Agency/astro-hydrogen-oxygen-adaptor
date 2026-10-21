import { createSignal } from 'solid-js';

export default function SolidCounter(props: { label: string; start?: number }) {
  const [count, setCount] = createSignal(props.start ?? 0);
  return (
    <button id="solid-counter" data-hydrated={count() !== (props.start ?? 0) ? 'yes' : undefined} onClick={() => setCount(count() + 1)}>
      {props.label} {count()}
    </button>
  );
}
