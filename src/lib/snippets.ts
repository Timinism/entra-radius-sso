import type { Device } from "./types";

export function ciscoSnippet(device: Device, host: string, authPort: number, acctPort: number): string {
  return [
    "aaa new-model",
    "aaa authentication login HARBOR group radius local",
    "aaa authorization exec HARBOR group radius local",
    "radius server HARBOR",
    ` address ipv4 ${host} auth-port ${authPort} acct-port ${acctPort}`,
    " timeout 50",
    " retransmit 1",
    ` key ${device.sharedSecret}`,
    "aaa group server radius HARBOR",
    " server name HARBOR",
    `! Packets must leave ${device.name} from ${device.nasIp}.`,
    "! ip radius source-interface <interface with that address>",
    "line vty 0 4",
    " login authentication HARBOR",
    " authorization exec HARBOR",
    " transport input ssh",
  ].join("\n");
}

export function paloAltoSteps(device: Device, host: string, authPort: number): string[] {
  const profile = device.os === "panorama" ? "Panorama" : "Device";
  const steps = [
    `${profile} > Server Profiles > RADIUS. Add a profile named Harbor.`,
    `Server ${host}, port ${authPort}, secret from this device, protocol PAP, timeout 50, retries 1.`,
    `${profile} > Authentication Profile. Type RADIUS, server profile Harbor.`,
    device.os === "panorama"
      ? "Panorama > Setup > Management > Authentication Settings. Choose that profile for administrators."
      : "Device > Setup > Management > Authentication Settings. Choose that profile for administrators.",
  ];
  if (device.service !== "device-admin") {
    steps.push(
      "Network > GlobalProtect > Gateways > Authentication. Add Harbor as a client authentication profile.",
      "Security policy can match the PaloAlto-User-Group value Harbor returns.",
    );
  }
  if (device.os === "panorama") {
    steps.push("Harbor sends PaloAlto-Panorama-Admin-Role. The role name has to exist on Panorama.");
  } else if (device.service !== "globalprotect") {
    steps.push("Harbor sends PaloAlto-Admin-Role. Built-in names such as superuser and deviceadmin already exist.");
  }
  return steps;
}
