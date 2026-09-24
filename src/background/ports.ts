export const PORT_NAMES = ["popup", "options"] as const;

export type PortName = (typeof PORT_NAMES)[number];

interface PortLike {
  name: string;
  sender?: { id?: string; url?: string };
}

export function isTrustedPort(
  port: PortLike,
  runtimeId: string,
  extensionOrigin: string,
): boolean {
  const sender = port.sender;
  if (!sender || sender.id !== runtimeId) return false;
  if (!sender.url?.startsWith(extensionOrigin)) return false;
  return (PORT_NAMES as readonly string[]).includes(port.name);
}
