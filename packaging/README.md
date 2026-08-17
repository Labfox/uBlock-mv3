# Self-hosted install via GitHub Pages + policy RPM

This directory packages the browser policy that force-installs the MV3 port.
It exists because force-installed extensions are the only ones that keep
`webRequestBlocking` under MV3 and get the `chrome.userScripts` API without the
per-extension "Allow user scripts" toggle. The alternative,
`--allowlisted-extension-id`, has to be passed on every launch and makes Chrome
show an "unsupported command-line flag" infobar.

The full chain is:

```
policy RPM  ->  ExtensionInstallForcelist
                    |  extension id ; update url
                    v
            https://<owner>.github.io/<repo>/update.xml   (GitHub Pages)
                    |  codebase
                    v
            https://<owner>.github.io/<repo>/uBlock0_<version>.crx
```

Everything downstream of the policy is already built by
`.github/workflows/gh-pages.yml`, which packs the CRX, writes `update.xml` and
deploys both to Pages on every push to `master`. The only new piece here is the
RPM that points a machine at it.

## 1. Create a signing key

The extension ID is derived from the CRX signing key, so the key *is* the
extension's identity. Generate one and keep it out of the repository:

```sh
tools/crx-id.sh --generate ~/ublock-mv3-key.pem
```

That prints the 32-character ID. Losing this key means every installed copy
stops receiving updates, because a new key produces a different ID and browsers
treat it as an unrelated extension.

Do not reuse the upstream ID `blockddmmcjpfkbhanlgegpmjpfpfjka` — that belongs
to the original author's key, and your builds cannot be signed for it.

## 2. Configure the fork

In your fork's repository settings:

| Setting | Where | Value |
| --- | --- | --- |
| `CRX3_PRIVATE_KEY` | Secrets → Actions | full contents of `ublock-mv3-key.pem` |
| `CRX3_ID` | Variables → Actions | the ID from step 1 |
| `PAGES_URL` | Variables → Actions | `<owner>.github.io/<repo>` (no scheme, no trailing slash) |
| Pages source | Pages | GitHub Actions |

Then push to `master` and let the workflow run. Verify before going further:

```sh
curl -sI https://<owner>.github.io/<repo>/update.xml
curl -s  https://<owner>.github.io/<repo>/update.xml
```

The `appid` in the XML must equal `CRX3_ID`, and the `version` must equal the
version in the CRX's `manifest.json`. A mismatch on either makes the browser
refuse the install or re-download in a loop, in both cases silently.

GitHub Pages serves `.xml` as `application/xml`, which is why this is preferred
over `raw.githubusercontent.com` — raw serves it as `text/plain`.

## 3. Build the policy RPM

```sh
packaging/rpm/build-rpm.sh --key ~/ublock-mv3-key.pem
```

The update URL is derived from the `origin` remote. On a fresh clone of this
repository `origin` still points at the upstream author, so either re-point it
at your fork or pass the URL explicitly:

```sh
packaging/rpm/build-rpm.sh \
    --id <32-char-id> \
    --url https://<owner>.github.io/<repo>/update.xml
```

The RPM lands in `dist/build/`. `rpmbuild` is used when present, otherwise the
build runs in a Fedora container via `podman` or `docker`, so this works from a
non-RPM workstation.

The package writes the same policy file into the configuration directory of
every browser listed in `%global browsers` — currently Chromium, Trivalent and
Google Chrome. A policy file belonging to a browser that is not installed is
inert, so there is no reason to build browser-specific variants; narrow it with
`--browsers "chromium trivalent"` if you would rather not.

## 4. Install on Silverblue / secureblue

```sh
sudo rpm-ostree install ./dist/build/ublock-mv3-policy-*.rpm
sudo systemctl reboot
```

`rpm-ostree install --apply-live` avoids the reboot, but the browser still has
to be fully restarted for the policy to be read.

If you build your own image, prefer baking it in over layering — layered
packages have to be re-resolved on every base image update:

```dockerfile
COPY ublock-mv3-policy-*.rpm /tmp/
RUN rpm-ostree install /tmp/ublock-mv3-policy-*.rpm && rm -f /tmp/*.rpm
```

## 5. Verify

Open `chrome://policy`. `ExtensionInstallForcelist` should be listed with
status OK and your ID in the value. Then `chrome://extensions` should show
uBlock Origin as installed by enterprise policy and not removable.

If the policy shows but the extension does not appear, the failure is in the
update chain rather than the policy: check `chrome://extensions` with developer
mode on, use "Update", and confirm the `update.xml` `version` matches the CRX.

## Things that quietly do not work

**Flatpak browsers do not read `/etc`.** A Flatpak Chromium reads policy from
`~/.var/app/<app-id>/config/chromium/policies/managed/` instead, so this RPM
has no effect on one. Check with `flatpak list | grep -i chrom` before
assuming.

**Trivalent's policy directory is assumed, not verified.** `/etc/trivalent` is
the conventional path for a Chromium fork named `trivalent`, but this was not
confirmed against a real install. On the target machine:

```sh
rpm -ql trivalent | grep -i polic
strings "$(command -v trivalent)" | grep 'policies/managed'
```

`chrome://policy` is the authoritative answer either way — if the policy is not
listed there, the directory is wrong.

**Only one file in `managed/` wins for a given policy.** The browser reads
every `*.json` in the directory, and for a policy name set in more than one
file only one takes effect. The file here is named `ublock-mv3.json` rather
than the generic `policy.json` to reduce collisions, but if something else on
the system already sets `ExtensionInstallForcelist`, check `chrome://policy`
and merge the two lists into a single file by hand.

**Windows and macOS block this route.** Chrome there refuses force-installed
extensions with custom update URLs absent real enterprise enrollment. Linux
only.

**The update URL must be HTTPS**, and the CRX download is fetched by the
browser rather than by the policy, so Pages must serve both.
