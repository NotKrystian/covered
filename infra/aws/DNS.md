# App Runner path retired; live host is EC2 3.8.77.227 / covered.kawuc.uk
# DNS for `covered.kawuc.uk` → App Runner

Status (2026-09-26): the custom domain is **associated** with the App Runner
service `covered` (`eu-west-2`) and sits in `pending_certificate_dns_validation`
until these CNAMEs exist in the Cloudflare zone `kawuc.uk`.

The Cloudflare API token in `~/.config/covered/cloudflare.env` cannot edit DNS
(Cloudflare returns an authentication error), so `scripts/dns-apply.sh` could not
create them. Either add them by hand in the Cloudflare dashboard (DNS → Records)
or give the token `Zone → DNS → Edit` on `kawuc.uk` and re-run
`scripts/dns-apply.sh` (idempotent).

All three records must be **DNS only** (grey cloud, not proxied): App Runner
validates the domain and terminates TLS itself, so Cloudflare must not sit in
front of the CNAME.

| Type  | Name | Target | Proxy |
| ----- | ---- | ------ | ----- |
| CNAME | `covered` (i.e. `covered.kawuc.uk`) | `gvykkgiap5.eu-west-2.awsapprunner.com` | DNS only |
| CNAME | `_d043b5bb59609e3d416bde82aaf129c4.covered` | `_4f863f53b9aac422ec7298875f40c870.wzccmgtwzk.acm-validations.aws` | DNS only |
| CNAME | `_945e8eb2044a98dbcf1ae963ddc794de.r47eryifol9og2qsh5qefocby7ztbzx.covered` | `_e7fd9a099188e65276102534cf1c18ed.wzccmgtwzk.acm-validations.aws` | DNS only |

Cloudflare accepts the name either relative (`covered`) or fully qualified
(`covered.kawuc.uk`). TTL: Auto.

Check progress (goes `pending_certificate_dns_validation` → `active`, usually
within minutes of the records resolving; can take up to ~30 min):

```bash
scripts/dns-apply.sh --print
# or
aws apprunner describe-custom-domains --region eu-west-2 \
  --service-arn arn:aws:apprunner:eu-west-2:616532055961:service/covered/dfb181f38111470584d5d57c8e0e5d24 \
  --query 'CustomDomains[].{domain:DomainName,status:Status}'
```

Note: the earlier tunnel/EC2 plans pointed `covered.kawuc.uk` at Cloudflare
(proxied). Only one `covered` CNAME can exist; the App Runner one above must
replace it and must be un-proxied.
