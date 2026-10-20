# Security

Placard runs entirely in your browser and makes no network requests: the
page's Content-Security-Policy sets `connect-src 'none'`, and only Placard's
own hashed scripts may run.

The main thing that reaches Placard from outside is **design files people
send each other**. Opening one must never run code or reach the network.
If you find a way, that's a security bug.

## Reporting

Please report privately, not in a public issue: use **GitHub → Security →
Report a vulnerability** on this repository. Include steps or a design file
that shows the problem. You'll get a reply within a few days, and credit in
the fix if you'd like it.

## Downloading Placard safely

Only download `placard.html` from this repository's **Releases** page, and
check it against the `placard.html.sha256` file published with it. Copies
elsewhere may have been changed.
