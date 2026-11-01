# Goodfellow sign-in service

This is [Goodfellow CMS](https://goodfellow-cms.github.io/goodfellow-cms/)'s sign-in service. Run it on your own Cloudflare account, on the free plan, and the editors of your sites on GitHub can choose **Sign in with GitHub** in the admin panel, rather than pasting a token. It keeps nothing: no tokens, no sessions and no list of editors. GitHub decides who may edit, every time.

## Put it online

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/goodfellow-cms/goodfellow-sign-in)

1. Choose **Deploy to Cloudflare** above. Sign in to Cloudflare (or make a free account), and connect your GitHub account when Cloudflare asks: it copies this repository there, which is where the service's updates arrive. Keep the names it suggests, or choose your own, and choose **Create and deploy**.
2. When it's deployed, open the service's address with `/setup` after it, such as `https://sign-in.your-name.workers.dev/setup`.
3. The page asks for a Cloudflare API token, and links to Cloudflare's page for making one with what it needs filled in. Paste it, with your sites' addresses, and the page saves the service's settings in Cloudflare. It uses the token only while you set the service up, and never keeps it: delete it afterwards in Cloudflare's **My Profile → API Tokens**.
4. The page then makes the service's two GitHub Apps with you, one at a time: GitHub shows each one's settings, filled in, and you choose **Create GitHub App**.
5. In your site's admin panel, open **Site Settings → Security**, put the service's address under **Sign-in service** and publish. The first time you sign in after the site has rebuilt, it offers to install the app on the site's repository.

To change your sites' addresses later, open `/setup` again: it asks for a token each time. To make new GitHub Apps, delete the service's secrets in Cloudflare (the Worker's **Settings → Variables and Secrets**), then open `/setup`.

## Updates

Each week, this repository's **Update** workflow takes the newest release of Goodfellow, a day after it's out, and pushes it, and Cloudflare deploys it. You can also run it from the **Actions** tab. GitHub turns off scheduled workflows in public repositories that have had no activity for 60 days, and says so on the Actions tab: turn it on again there.

## More

[Sign-in service](https://goodfellow-cms.github.io/goodfellow-cms/docs/sign-in-service) in Goodfellow's documentation says how it works, what it keeps, and how to run it from your own computer instead.
