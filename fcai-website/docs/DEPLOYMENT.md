# Deployment preparation

This project now has a container build with Caddy as its HTTPS reverse proxy, but it has **not** been deployed or
load-tested on a college server. Port 8080 is internal to the Compose network; only the Caddy proxy publishes HTTP
and HTTPS. Do not publish the app container directly.

## Requirements from the college IT team

Before deployment, obtain:

- The approved Linux/Docker host, its owner, and a maintenance contact.
- A production domain controlled by the college, with DNS pointing to the server and inbound ports 80/443 available.
- A named data owner and authorization to collect student account/request information.
- An approved privacy notice, retention period, backup schedule, and account-recovery procedure.
- Confirmation of the official timetable, contact details, announcements, and any content presented as official.
- The expected peak traffic and any uptime/monitoring requirements.

Do not send SSH keys, passwords, database dumps, or other credentials in chat. The administrator should provision
access through the college's approved secret-management process.

## Build and start

On the approved Docker host, from a reviewed copy of this project, set the DNS name in a local `.env` file
(ignored by Git). Do not use `localhost` for a public website; it only refers to the current machine and cannot
receive a publicly trusted certificate:

```sh
printf 'SITE_ADDRESS=fcai.example.edu.eg\n' > .env
```

Replace the example with the actual college-controlled domain. Ensure its DNS A/AAAA records point to this host,
and firewall rules permit inbound TCP ports 80 and 443 (and UDP 443 if HTTP/3 is enabled).

Then build and start:

```sh
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 app
```

Caddy obtains and renews the HTTPS certificate automatically. The application is not published to a host port and
receives trusted forwarding headers only from the Compose proxy. Verify certificate issuance, HTTP-to-HTTPS
redirects, and the final public domain with the college IT team. Caddy overwrites forwarding headers so the app's
rate limits use the proxy-observed client IP, not a client-supplied forwarding value.

Create the first administrator in an interactive session; save the generated password in the college's secret
manager, not in shell history or a ticket:

```sh
docker compose run --rm app npm run admin:create -- --email ADMIN_EMAIL
```

The database is stored in the persistent `fcai-data` Docker volume. Back it up using an approved SQLite-aware,
consistent backup procedure and verify restore drills. Do not remove the volume to update the application.
Rotate a password with `docker compose run --rm app npm run admin:password -- --email ADMIN_EMAIL`.

## Pre-launch acceptance checklist

- Replace or explicitly approve every sample item and illustration. The gallery, library catalogue, projects,
  announcements, and seeded complaints are demonstrations, not verified college records.
- Have the college approve all names, schedules, contact information, public forms, privacy/consent text, and
  retention/deletion rules. Do not collect real student data before this approval.
- Confirm HTTPS redirects, session cookies (`Secure`, `HttpOnly`, `SameSite=Strict`), reverse-proxy header handling,
  admin approval/blocking, logout, backups, restore, monitoring, and least-privilege operator access.
- Load-test the deployed host with IT-approved tools and representative traffic; the development environment is not
  evidence of production capacity. Record response latency, error rate, CPU, memory, SQLite write contention, and
  the agreed pass/fail thresholds.
- Conduct an independent security review and resolve its findings before public launch.
- Pin the approved container image versions/digests and scan the final images before launch.
- Confirm the college's legal, accessibility, and information-security approval.

## Current limits

The application uses a single-process SQLite database. It is suitable for a pilot only after the college validates
the expected load and backup plan. It does not include university SSO, verified student identity, grades, file
uploads, email verification, password recovery, or a formal privacy/consent workflow. Account signup is
administrator-approved but currently accepts self-entered email and student ID; it does not prove that the person
is enrolled. Do not represent it as an official student records system.
