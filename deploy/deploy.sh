#!/usr/bin/env bash
# Build and publish NMAViz on the xera.ac box. Run from a checkout on the
# server, as the xeradb user:
#
#   cd /var/www/nmaviz && git pull && ./deploy/deploy.sh
#
# The nginx vhost and the TLS certificate are installed once by hand; see the
# header of deploy/nmaviz.xera.ac.nginx for those root-only commands.
#
# The test suite runs before the build on purpose. The whole claim of this site
# is that its arithmetic matches netmeta, and a deploy that has not checked that
# is a deploy of an unverified claim.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci --no-audit --no-fund
npm test
npm run build

cp deploy/nmaviz.xera.ac.nginx ~/nmaviz.xera.ac.nginx

echo "Built $(du -sh dist | cut -f1) into dist/. nginx serves it directly; no reload is needed for content changes."
