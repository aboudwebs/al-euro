#!/usr/bin/env bash
# Pins every `uses: owner/repo@tag` in .github/workflows to the commit SHA of that tag (keeps the tag as a comment).
# Needs the GitHub CLI logged in (gh auth status). Review the diff before committing.
set -euo pipefail
cd "$(dirname "$0")/.."
for file in .github/workflows/*.yml; do
  grep -oE 'uses: [A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+' "$file" | sort -u | while read -r _ ref; do
    repo="${ref%@*}"; tag="${ref#*@}"
    [[ "$tag" =~ ^[0-9a-f]{40}$ ]] && continue
    sha=$(gh api "repos/$repo/commits/$tag" --jq .sha)
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "could not resolve $repo@$tag" >&2; exit 1; }
    sed -i "s|uses: $repo@$tag\$|uses: $repo@$sha # $tag|" "$file"
    echo "$file: $repo@$tag -> $sha"
  done
done
