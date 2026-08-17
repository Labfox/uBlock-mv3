# Browser policy package for the uBlock Origin MV3 port.
#
# Chromium grants webRequestBlocking and the chrome.userScripts API to
# force-installed extensions without the --allowlisted-extension-id flag and
# without the per-extension "Allow user scripts" toggle. This package ships
# nothing but the ExtensionInstallForcelist policy that triggers that.
#
# The extension ID and update URL are build-time inputs, because the ID is
# derived from the CRX signing key. Build with:
#
#   rpmbuild -bb ublock-mv3-policy.spec \
#       --define "extid <32-char-id>" \
#       --define "update_url https://<owner>.github.io/<repo>/update.xml"
#
# packaging/rpm/build-rpm.sh wraps this and fills the values in for you.

# Overridable with --define "browsers chromium trivalent". Must stay
# conditional: an unconditional %%global would win over the command line.
%{!?browsers: %global browsers chromium trivalent chrome}

%{!?extid: %{error: extid is required: --define "extid <32-char-id>"}}
%{!?update_url: %{error: update_url is required: --define "update_url <url>"}}

# Nothing here is compiled, so skip the machinery that assumes there is a build.
%global debug_package %{nil}

Name:           ublock-mv3-policy
Version:        %{?pkgversion}%{!?pkgversion:1.73.0}
Release:        1%{?dist}
Summary:        Browser policy that force-installs the uBlock Origin MV3 port

License:        GPL-3.0-only
URL:            https://github.com/r58Playz/uBlock-mv3
BuildArch:      noarch

BuildRequires:  python3

%description
Installs an ExtensionInstallForcelist policy so that Chromium-based browsers
force-install the uBlock Origin MV3 port, an unofficial port of the full
Manifest V2 uBlock Origin to Manifest V3.

Force-installed extensions retain the webRequestBlocking permission and are
granted the chrome.userScripts API, neither of which a normally sideloaded MV3
extension can obtain. This removes the need for the
--allowlisted-extension-id command-line flag.

Extension ID: %{extid}
Update URL:   %{update_url}

The policy is written for each of: %{browsers}. A policy file sitting in the
configuration directory of a browser that is not installed is inert, so the
package does not need to know which browsers are present.

%prep
%autosetup -c -T

%build
cat > ublock-mv3.json <<'POLICY_EOF'
{
  "ExtensionInstallForcelist": [
    "%{extid};%{update_url}"
  ]
}
POLICY_EOF

# A malformed policy file is ignored silently by the browser, which is a
# miserable thing to debug on a deployed machine. Fail the build instead.
python3 -c 'import json,sys; json.load(open("ublock-mv3.json"))'

%install
: > files.list
for browser in %{browsers}; do
    case "$browser" in
        chrome) dir=%{_sysconfdir}/opt/chrome ;;
        *)      dir=%{_sysconfdir}/$browser ;;
    esac
    install -d %{buildroot}$dir/policies/managed
    install -m 0644 ublock-mv3.json %{buildroot}$dir/policies/managed/ublock-mv3.json

    # Own every directory this package creates. On a stock system none of them
    # belong to any package, so without this they are left behind on uninstall.
    # /etc and /etc/opt themselves belong to the filesystem package and are
    # deliberately not listed here.
    echo "%dir $dir" >> files.list
    echo "%dir $dir/policies" >> files.list
    echo "%dir $dir/policies/managed" >> files.list
    echo "%config(noreplace) $dir/policies/managed/ublock-mv3.json" >> files.list
done

%files -f files.list

%changelog
* Mon Aug 17 2026 uBlock-mv3 packaging <nobody@localhost> - 1.73.0-1
- Initial policy package
