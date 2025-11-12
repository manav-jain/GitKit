# Slack PR Approval Bot

A Node.js Slack bot that can approve GitHub pull requests when mentioned with the `approve` command in message replies.

## Features

- 🔍 **Auto-detect PR references** in parent messages when replied to
- ✅ **Explicit approval command** - Type `approve` with bot mention to approve PRs
- 📊 **Display PR details** including reviews, status, and author
- 🔗 **Multiple format support**: GitHub URLs, `owner/repo#123`, or `#123`
- ⚡ **Slash command** `/approve-pr` for direct approval
- 🎨 **Rich Slack formatting** with interactive buttons
- 🚀 **Easy deployment** on Render or Vercel

## Installation

### Prerequisites

- Node.js 18+ and npm
- Slack workspace with admin access
- GitHub account with repository access

### 1. Clone and Install

```bash
git clone <your-repo>
cd slack-pr-approval-bot
npm install
```

### 2. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name your app and select workspace

#### Configure OAuth & Permissions:
Add these Bot Token Scopes:
- `app_mentions:read`
- `channels:history`
- `chat:write`
- `commands`

#### Enable Socket Mode:
1. Go to Socket Mode in the sidebar
2. Enable Socket Mode
3. Create an App-Level Token with `connections:write` scope
4. Save the token (starts with `xapp-`)

#### Enable Events:
Subscribe to bot events:
- `app_mention`

#### Add Slash Command:
Create command: `/approve-pr`

#### Install App:
Install the app to your workspace and copy the Bot User OAuth Token (starts with `xoxb-`)

### 3. Create GitHub Token

1. Go to GitHub → Settings → Developer settings
2. Personal access tokens → Tokens (classic)
3. Generate new token with scopes:
   - `repo` (full control)
   - `read:org` (if working with org repos)

### 4. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your tokens:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
GITHUB_TOKEN=ghp_your_github_token
DEFAULT_REPO=owner/repo  # Optional
```

### 5. Run the Bot

```bash
# Production
npm start

# Development (with auto-restart)
npm run dev
```

## Usage

### Reply to a Message with PR Reference

1. Find a message containing a PR link or reference
2. Reply to it and mention the bot with `approve`: 
   - `approve @bot` or `@bot approve`
3. Bot will detect the PR from the parent message and approve it

### Direct Mention

```
@bot approve owner/repo#123
```

Or just mention the bot to see PR details, then type `approve` in a follow-up message:

```
@bot owner/repo#123
# Bot shows PR details
approve @bot
# Bot approves the PR
```

### Slash Command

```
/approve-pr https://github.com/owner/repo/pull/456
```

## Supported PR Formats

- **Full URL**: `https://github.com/owner/repo/pull/123`
- **Short reference**: `owner/repo#123`
- **Number only**: `#123` (requires DEFAULT_REPO in .env)

## Project Structure

```
slack-pr-approval-bot/
├── index.js          # Main bot application
├── package.json      # Node dependencies
├── render.yaml       # Render deployment configuration
├── vercel.json       # Vercel deployment configuration
├── .env             # Environment variables (create from .env.example)
├── .env.example     # Environment template
└── README.md        # This file
```

## Deployment Options

### 🚀 Deploy on Render (Recommended)

[Render](https://render.com) is ideal for Socket Mode bots as it supports persistent WebSocket connections.

#### Quick Deploy:

1. **Fork/Clone this repository** to your GitHub account

2. **Create a new Web Service on Render:**
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the repository

3. **Configure the service:**
   - **Name**: `slack-pr-approval-bot` (or your preferred name)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free tier works fine

4. **Add Environment Variables:**
   - Go to "Environment" tab
   - Add the following variables:
     ```
     SLACK_BOT_TOKEN=xoxb-your-bot-token
     SLACK_APP_TOKEN=xapp-your-app-token
     SLACK_SIGNING_SECRET=your-signing-secret
     GITHUB_TOKEN=ghp_your_github_token
     DEFAULT_REPO=owner/repo  # Optional
     NODE_ENV=production
     ```

5. **Deploy:**
   - Click "Create Web Service"
   - Render will automatically build and deploy your bot
   - Check the logs to ensure it's running

#### Using render.yaml (Alternative):

If you prefer configuration as code, the repository includes a `render.yaml` file. Simply:
- Push your code to GitHub
- In Render, select "New +" → "Blueprint"
- Connect your repository
- Render will automatically detect and use `render.yaml`

### ⚡ Deploy on Vercel

⚠️ **Note**: Vercel is serverless and has execution time limits. Since this bot uses Socket Mode (persistent WebSocket connections), **Render is strongly recommended** over Vercel. However, if you still want to try Vercel:

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Set Environment Variables:**
   ```bash
   vercel env add SLACK_BOT_TOKEN
   vercel env add SLACK_APP_TOKEN
   vercel env add SLACK_SIGNING_SECRET
   vercel env add GITHUB_TOKEN
   vercel env add DEFAULT_REPO  # Optional
   ```

4. **Redeploy with environment variables:**
   ```bash
   vercel --prod
   ```

   Or set them in the [Vercel Dashboard](https://vercel.com/dashboard) → Your Project → Settings → Environment Variables

**Limitations on Vercel:**
- Serverless functions have a 10-second execution limit (Hobby plan) or 60 seconds (Pro plan)
- Socket Mode requires persistent connections, which may not work reliably
- Consider using Render or another platform for production

### Using PM2 (Self-hosted)

```bash
npm install -g pm2
pm2 start index.js --name pr-bot
pm2 save
pm2 startup
```

### Using Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "index.js"]
```

Build and run:
```bash
docker build -t slack-pr-bot .
docker run -d --env-file .env --name pr-bot slack-pr-bot
```

### Using Heroku

```bash
heroku create your-app-name
heroku config:set SLACK_BOT_TOKEN=xoxb-...
heroku config:set SLACK_APP_TOKEN=xapp-...
heroku config:set SLACK_SIGNING_SECRET=...
heroku config:set GITHUB_TOKEN=ghp_...
git push heroku main
```

## Advanced Configuration

### Custom Approval Messages

Modify the `approvePR` method in `index.js` to customize the approval message:

```javascript
await octokit.pulls.createReview({
  owner: prInfo.owner,
  repo: prInfo.repo,
  pull_number: prInfo.prNumber,
  event: 'APPROVE',
  body: 'Your custom approval message here 🎉'
});
```

### Add PR Merge Capability

Add this method to the `PRApprovalBot` class:

```javascript
async mergePR(prInfo) {
  try {
    await octokit.pulls.merge({
      owner: prInfo.owner,
      repo: prInfo.repo,
      pull_number: prInfo.prNumber,
      merge_method: 'squash' // or 'merge' or 'rebase'
    });
    return { success: true, message: 'PR merged successfully' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}
```

## Troubleshooting

### Bot not responding
- Check Socket Mode is enabled in Slack app settings
- Verify all tokens are correctly set in `.env`
- Check bot has been added to the channel

### GitHub API errors
- Verify GitHub token has `repo` scope
- Check you have write access to the repository
- Ensure PR is not already approved

### Permission errors
- Ensure bot is invited to the channel: `/invite @bot-name`
- Check OAuth scopes in Slack app settings

## Security Notes

- Never commit `.env` file to version control
- Rotate tokens regularly
- Use environment-specific tokens for dev/staging/prod
- Consider implementing rate limiting for production use

## Contributing

Pull requests are welcome! Please ensure:
1. Code follows existing style
2. Tests are included for new features
3. Documentation is updated

## License

MIT

## Support

For issues or questions:
- Create an issue in the repository
- Check Slack API docs: [api.slack.com](https://api.slack.com)
- Check GitHub API docs: [docs.github.com](https://docs.github.com)