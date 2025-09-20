# bri-b-dev.github.io
GitHub Page


---

```bash
npm run build
git checkout -B gh-pages
git --work-tree build add --all
git --work-tree build commit -m "Deploy"
git push -f origin gh-pages
git checkout main
```
