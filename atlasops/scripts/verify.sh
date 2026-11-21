#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
echo '== Checking backend syntax =='
find api/src api/test -name '*.js' -exec node --check {} \;
echo '== Running local no-dependency tests =='
(cd api && node --test test/insights.test.js)
echo '== Checking that hard-coded obvious secrets are absent =='
if grep -REn '(sk-[A-Za-z0-9]{20}|-----BEGIN (RSA|OPENSSH) PRIVATE KEY-----)' --include='*.js' --include='*.ts' --include='*.tsx' api/src web/src; then
 echo 'Potential embedded secret detected' >&2
 exit 1
fi
echo 'Static verification complete. A passing result DOES NOT replace web, Postgres, Android, CI, security or device tests.'
