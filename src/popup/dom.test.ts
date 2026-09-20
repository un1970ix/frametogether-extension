import { describe, expect, test } from "bun:test";
import { button, el, field } from "./dom";

const HOSTILE = '<img src=x onerror="alert(1)">';

describe("el", () => {
  test("applies props and appends string children as text", () => {
    const node = el("p", { className: "info" }, "hello ", "world");
    expect(node.tagName).toBe("P");
    expect(node.className).toBe("info");
    expect(node.textContent).toBe("hello world");
  });

  test("appends element children in order", () => {
    const node = el("p", {}, el("strong", { textContent: "a" }), el("code", { textContent: "b" }));
    expect(node.children.length).toBe(2);
    expect(node.children[0]?.tagName).toBe("STRONG");
    expect(node.children[1]?.tagName).toBe("CODE");
  });

  test("treats a hostile textContent as text, never markup", () => {
    const node = el("span", { textContent: HOSTILE });
    expect(node.textContent).toBe(HOSTILE);
    expect(node.children.length).toBe(0);
    expect(node.querySelector("img")).toBeNull();
    expect(node.innerHTML).not.toContain("<img");
  });

  test("treats a hostile string child as text, never markup", () => {
    const node = el("p", {}, HOSTILE);
    expect(node.textContent).toBe(HOSTILE);
    expect(node.querySelector("img")).toBeNull();
    expect(node.innerHTML).not.toContain("<img");
  });
});

describe("field", () => {
  test("renders a bold label followed by its value", () => {
    const node = field("Room:", "abc");
    expect(node.tagName).toBe("P");
    expect(node.children[0]?.tagName).toBe("STRONG");
    expect(node.children[0]?.textContent).toBe("Room:");
    expect(node.textContent).toBe("Room: abc");
  });

  test("keeps a hostile value inert", () => {
    const node = field("You are:", HOSTILE);
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toBe(`You are: ${HOSTILE}`);
  });

  test("accepts an element value", () => {
    const node = field("Room:", el("code", { textContent: "xyz" }));
    expect(node.querySelector("code")?.textContent).toBe("xyz");
  });
});

describe("button", () => {
  test("sets id, variant class and label", () => {
    const node = button("joinBtn", "secondary", "Join Room", () => {});
    expect(node.id).toBe("joinBtn");
    expect(node.className).toBe("btn btn-secondary");
    expect(node.textContent).toBe("Join Room");
  });

  test("fires its handler on click", () => {
    let clicks = 0;
    const node = button("createBtn", "primary", "Create Room", () => {
      clicks += 1;
    });
    node.click();
    node.click();
    expect(clicks).toBe(2);
  });
});
