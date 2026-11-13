import type { Device } from "./types";

export function ciscoSnippet(device: Device, host: string, authPort: number, acctPort: number, tlsPort = 11814): string {
  const logins = device.logins?.length ? device.logins : ["ssl", "sso", "local"];
  const lines = [
    "aaa new-model",
    "aaa authentication login HARBOR group radius local",
    "aaa authorization exec HARBOR group radius local",
    "! SSO waits for the browser. Local checks a Harbor password. Keep one local",
    "! username on the switch in case Harbor cannot be reached.",
    "radius server HARBOR",
    ` address ipv4 ${host} auth-port ${authPort} acct-port ${acctPort}`,
    " timeout 50",
    " retransmit 1",
    ` key ${device.sharedSecret}`,
  ];
  if (logins.includes("ssl")) {
    lines.push(
      "! SSL. Import the Harbor CA as trustpoint HARBOR-CA, then:",
      "radius server HARBOR-SSL",
      ` address ipv4 ${host} auth-port ${tlsPort} acct-port ${tlsPort}`,
      ` tls port ${tlsPort}`,
      " tls trustpoint HARBOR-CA",
      ` key ${device.sharedSecret}`,
    );
  }
  lines.push("aaa group server radius HARBOR", " server name HARBOR");
  if (logins.includes("ssl")) lines.push(" server name HARBOR-SSL");
  lines.push(
    `! Packets must leave ${device.name} from ${device.nasIp}.`,
    "! ip radius source-interface <interface with that address>",
    "line vty 0 4",
    " login authentication HARBOR",
    " authorization exec HARBOR",
    " transport input ssh",
  );
  return lines.join("\n");
}

export function paloAltoSteps(device: Device, host: string, authPort: number, tlsPort = 11814): string[] {
  const profile = device.os === "panorama" ? "Panorama" : "Device";
  const logins = device.logins?.length ? device.logins : ["ssl", "sso", "local"];
  const steps = [
    `${profile} > Server Profiles > RADIUS. Add a profile named Harbor.`,
    `Server ${host}, port ${authPort}, secret from this device, protocol PAP, timeout 50, retries 1. SSO and local passwords use this UDP profile.`,
  ];
  if (logins.includes("ssl")) {
    steps.push(
      `Import the Harbor CA under ${profile} > Certificate Management. When this PAN-OS release can speak RADIUS over TLS, point a server at TCP ${tlsPort} and select that CA.`,
      "An SSL login presents a client certificate issued on Directory. The username has to match the certificate.",
    );
  }
  if (logins.includes("local")) {
    steps.push("A local login is the password set for that person on Directory. Harbor checks it and does not send it to Entra.");
  }
  if (logins.includes("sso")) {
    steps.push("SSO holds the RADIUS request while the person finishes the browser sign-in. The password typed at the CLI is not the Entra password.");
  }
  steps.push(
    `${profile} > Authentication Profile. Type RADIUS, server profile Harbor.`,
    device.os === "panorama"
      ? "Panorama > Setup > Management > Authentication Settings. Choose that profile for administrators."
      : "Device > Setup > Management > Authentication Settings. Choose that profile for administrators.",
  );
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
  steps.push(
    `Keep one local administrator on the ${device.os === "panorama" ? "Panorama" : "firewall"} so you can still sign in if Harbor is unreachable.`,
  );
  return steps;
}
