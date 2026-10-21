// Rendered only in the browser (client:only): the Worker emits an empty island for it.
export default function SolidBuyer(props: { country: string }) {
  return <p id="solid-buyer">solid-only {props.country}</p>;
}
