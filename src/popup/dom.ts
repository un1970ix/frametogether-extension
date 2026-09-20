export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function field(label: string, value: Node | string) {
  return el("p", {}, el("strong", { textContent: label }), " ", value);
}

export function button(
  id: string,
  variant: string,
  textContent: string,
  onClick: () => void,
) {
  const node = el("button", {
    id,
    className: `btn btn-${variant}`,
    textContent,
  });
  node.addEventListener("click", onClick);
  return node;
}
