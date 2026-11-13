# Harbor

Harbor is the sign-in path for Cisco IOS-XE and Palo Alto gear that already uses RADIUS. The device still sends an Access-Request. Harbor does not check that password against Microsoft Entra. It waits while the person signs in with Entra in the browser, then answers with the privilege level or admin role their group is allowed.

Until a tenant is connected, Harbor uses a sample Northline directory so the RADIUS reply can be proven on the test bench.

## Run

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:3847

The web console listens on port 3847. RADIUS authentication listens on UDP 11812 and accounting on UDP 11813. SSL logins use RADIUS over TLS on TCP 11814. All three stay up when you run `npm run dev` or `npm start`.

## Docker Compose

`docker compose up --build` runs the same app next to Postgres. The console is at http://127.0.0.1:3847. RADIUS authentication is UDP 11812, accounting is UDP 11813, and SSL is TCP 11814, published on the host. Devices, policies, and the audit are stored in Postgres. The container creates the table on first use. The sample Northline directory is used until `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` are set in the environment you launch Compose from. `HARBOR_DB_PASSWORD` overrides the local database password, which defaults to `harbor`.

`npm test` checks the RADIUS codec, group matching, a sample Cisco accept, and the component updater.

## Components

**Components** lists Next.js, React, and the other libraries this app is built with. Harbor reads the latest stable release from the npm registry, then chooses the newest version the rest of the set still supports. Next.js and `eslint-config-next` stay on a release both packages publish. TypeScript stops at the newest release the Next.js lint stack accepts, even when the TypeScript package has a newer major.

Update all installs those releases into this checkout. A built deployment can show the comparison, and the install runs where `npm` can write `package.json`. Set `HARBOR_COMPONENT_UPDATES=0` to keep the check and skip the install.

## What to click

1. Open **Test bench**, leave `maya.chen` on `core-sw01`, and send the Access-Request.
2. Open the approval and sign in as Maya Chen. The reply is `shell:priv-lvl=15`.
3. Repeat as `jordan.hale`. The switch rejects her. The same account is a Palo Alto superuser on `pa-edge-01`.
4. **Gear setup** shows the IOS-XE lines and the PAN-OS clicks for the device you pick. Set the host to an address the gear can route to, and set the device timeout near 50 seconds so the CLI waits for the browser sign-in.
5. Register the device’s RADIUS source address on **Devices**. Harbor ignores packets from anywhere else.

Break-glass is the local username `breakglass`. The sample password is on **Directory**. It is checked only inside Harbor, and every use is audited. It is not an Entra password.

Harbor accepts three logins. **SSO** holds the Access-Request while the person finishes in the browser. **Local** checks a password stored on that person in Directory and answers immediately. **SSL** is RADIUS over TLS. Download the Harbor CA from Directory, and issue a client certificate for the person. The test bench can present that certificate. Maya Chen is seeded with a local password and an SSL certificate. Both are shown on Directory. A matching local password does not open a browser sign-in. Each device chooses which of the three it allows.

## Connect Entra

Create an app registration in the Entra tenant:

- Accounts in this organization directory only
- Web redirect URI: the value shown on Directory (it ends in `/api/entra/callback`)
- A client secret
- Delegated Microsoft Graph permissions `User.Read` and `GroupMember.Read.All`, with admin consent

Harbor reads these environment variables:

- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`

When all three are present and the tenant and client id are a GUID or a tenant domain, sign-in goes to Microsoft. Group policies match the Graph display name, or the group object id if that is all the token contains. The client secret is never written to the database or the browser.

Policies are the group-to-privilege list. The first matching row wins. Paste either the group’s display name or its object id into the policy.

On the published app, add the three values in the secure form. The console keeps using the sample directory until they exist.

If Postgres is configured for the deployment, Harbor stores devices, policies, and the audit there. Otherwise it stores them in `data/` next to the app. Preview traffic is kept in its own copy.
