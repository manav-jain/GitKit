const { App } = require('@slack/bolt');
const { Octokit } = require('@octokit/rest');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000
});

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

class PRApprovalBot {
  constructor() {
    this.githubToken = process.env.GITHUB_TOKEN;
    this.defaultRepo = process.env.DEFAULT_REPO;
  }

  /**
   * Extract PR information from message text
   */
  extractPRInfo(text) {
    // Pattern for full GitHub PR URLs
    const urlPattern = /https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/;
    const urlMatch = text.match(urlPattern);
    
    if (urlMatch) {
      return {
        owner: urlMatch[1],
        repo: urlMatch[2],
        prNumber: parseInt(urlMatch[3]),
        type: 'github'
      };
    }
    
    // Pattern for PR references like owner/repo#123
    const refPattern = /([^\/\s]+)\/([^#\s]+)#(\d+)/;
    const refMatch = text.match(refPattern);
    
    if (refMatch) {
      return {
        owner: refMatch[1],
        repo: refMatch[2],
        prNumber: parseInt(refMatch[3]),
        type: 'github'
      };
    }
    
    // Pattern for just PR number (requires default repo configuration)
    const numberPattern = /#(\d+)/;
    const numberMatch = text.match(numberPattern);
    
    if (numberMatch && this.defaultRepo) {
      const [owner, repo] = this.defaultRepo.split('/');
      return {
        owner,
        repo,
        prNumber: parseInt(numberMatch[1]),
        type: 'github'
      };
    }
    
    return null;
  }

  /**
   * Generate URL to open PR in browser
   */
  getPRUrl(prInfo) {
    return `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.prNumber}`;
  }

  /**
   * Get PR details from GitHub
   */
  async getPRDetails(prInfo) {
    try {
      const { data: pr } = await octokit.pulls.get({
        owner: prInfo.owner,
        repo: prInfo.repo,
        pull_number: prInfo.prNumber,
      });

      const { data: reviews } = await octokit.pulls.listReviews({
        owner: prInfo.owner,
        repo: prInfo.repo,
        pull_number: prInfo.prNumber,
      });

      return {
        title: pr.title,
        state: pr.state,
        author: pr.user.login,
        url: pr.html_url,
        mergeable: pr.mergeable,
        draft: pr.draft,
        reviews: reviews.map(r => ({
          user: r.user.login,
          state: r.state
        }))
      };
    } catch (error) {
      console.error('Error getting PR details:', error.message);
      return null;
    }
  }

  /**
   * Approve a GitHub PR
   */
  async approvePR(prInfo) {
    try {
      // Get current user info
      const { data: currentUser } = await octokit.users.getAuthenticated();
      
      // Check existing reviews
      const { data: reviews } = await octokit.pulls.listReviews({
        owner: prInfo.owner,
        repo: prInfo.repo,
        pull_number: prInfo.prNumber,
      });
      
      // Check if already approved by current user
      const hasApproved = reviews.some(
        review => review.user.login === currentUser.login && review.state === 'APPROVED'
      );
      
      if (hasApproved) {
        return {
          success: false,
          message: `PR already approved by @${currentUser.login}`
        };
      }
      
      // Create approval review
      await octokit.pulls.createReview({
        owner: prInfo.owner,
        repo: prInfo.repo,
        pull_number: prInfo.prNumber,
        event: 'APPROVE'
      });
      
      return {
        success: true,
        message: `Successfully approved PR #${prInfo.prNumber}`
      };
      
    } catch (error) {
      console.error('Error approving PR:', error.message);
      return {
        success: false,
        message: `Error approving PR: ${error.message}`
      };
    }
  }

  /**
   * Format PR details for Slack message
   */
  formatPRDetails(prDetails) {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📋 PR Details:*\n` +
                `• *Title:* ${prDetails.title}\n` +
                `• *Author:* @${prDetails.author}\n` +
                `• *State:* ${prDetails.state} ${prDetails.draft ? '(Draft)' : ''}\n` +
                `• *Mergeable:* ${prDetails.mergeable === null ? 'Checking...' : prDetails.mergeable ? '✅' : '❌'}`
        }
      }
    ];

    if (prDetails.reviews && prDetails.reviews.length > 0) {
      const approvals = prDetails.reviews.filter(r => r.state === 'APPROVED');
      const changesRequested = prDetails.reviews.filter(r => r.state === 'CHANGES_REQUESTED');
      
      let reviewText = '*Reviews:*\n';
      if (approvals.length > 0) {
        reviewText += `• ✅ ${approvals.length} approval(s): ${approvals.map(r => `@${r.user}`).join(', ')}\n`;
      }
      if (changesRequested.length > 0) {
        reviewText += `• 🔄 ${changesRequested.length} changes requested: ${changesRequested.map(r => `@${r.user}`).join(', ')}`;
      }
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: reviewText
        }
      });
    }

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔗 View PR on GitHub'
          },
          url: prDetails.url,
          action_id: 'view_pr'
        }
      ]
    });

    return blocks;
  }
}

// Initialize bot
const prBot = new PRApprovalBot();

// Handle app mentions
app.event('app_mention', async ({ event, client, say }) => {
  console.log('Bot mentioned:', event.text);
  
  const { text, channel, thread_ts, ts } = event;
  const threadTs = thread_ts || ts;
  
  // Check if "approve" command is in the message text (case-insensitive)
  const textLower = text.toLowerCase();
  const hasApproveCommand = /\bapprove\b/.test(textLower);
  
  try {
    // Check if this is a reply in a thread
    if (thread_ts) {
      let parentText = '';
      
      // Try to get the parent message
      try {
        const result = await client.conversations.history({
          channel,
          latest: thread_ts,
          limit: 1,
          inclusive: true
        });
        
        if (result.messages && result.messages.length > 0) {
          parentText = result.messages[0].text || '';
        }
      } catch (historyError) {
        // Handle channel access errors gracefully
        if (historyError.data && historyError.data.error === 'channel_not_found') {
          console.warn(`Channel not found or bot doesn't have access: ${channel}`);
          // Continue without parent message - will extract from current message only
        } else {
          console.error('Error fetching conversation history:', historyError.message);
          // Continue without parent message - will extract from current message only
        }
      }
      
      // Extract PR info from parent message first, then from mention
      let prInfo = prBot.extractPRInfo(parentText) || prBot.extractPRInfo(text);
      
      if (prInfo) {
        // Get PR details
        const prDetails = await prBot.getPRDetails(prInfo);
        
        if (prDetails) {
          // Send PR details
          await say({
            blocks: prBot.formatPRDetails(prDetails),
            text: `PR: ${prDetails.title}`,
            thread_ts: threadTs
          });
          
          // Only approve if "approve" command is present
          if (hasApproveCommand) {
            // Send processing message
            await say({
              text: '⏳ Processing approval request...',
              thread_ts: threadTs
            });
            
            // Approve the PR
            const result = await prBot.approvePR(prInfo);
            
            if (result.success) {
              await say({
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `✅ *${result.message}*`
                    }
                  },
                  {
                    type: 'actions',
                    elements: [
                      {
                        type: 'button',
                        text: {
                          type: 'plain_text',
                          text: '🔗 View PR'
                        },
                        style: 'primary',
                        url: prBot.getPRUrl(prInfo)
                      }
                    ]
                  }
                ],
                text: result.message,
                thread_ts: threadTs
              });
            } else {
              await say({
                text: `❌ ${result.message}`,
                thread_ts: threadTs
              });
            }
          } else {
            // PR details shown, but no approve command - prompt user
            await say({
              text: '💡 Type `approve` in your message to approve this PR.',
              thread_ts: threadTs
            });
          }
        } else {
          await say({
            text: '❌ Could not fetch PR details. Please check the PR reference.',
            thread_ts: threadTs
          });
        }
      } else {
        await say({
          text: '❌ No PR reference found in the message. Please mention a PR URL or reference (e.g., `owner/repo#123`)',
          thread_ts: threadTs
        });
      }
    } else {
      // Direct mention (not in thread)
      const prInfo = prBot.extractPRInfo(text);
      
      if (prInfo) {
        // Get PR details
        const prDetails = await prBot.getPRDetails(prInfo);
        
        if (prDetails) {
          // Send PR details
          await say({
            blocks: prBot.formatPRDetails(prDetails),
            text: `PR: ${prDetails.title}`,
            thread_ts: threadTs
          });
          
          // Only approve if "approve" command is present
          if (hasApproveCommand) {
            await handlePRCommand(prInfo, say, threadTs);
          } else {
            // PR details shown, but no approve command - prompt user
            await say({
              text: '💡 Type `approve` in your message to approve this PR.',
              thread_ts: threadTs
            });
          }
        } else {
          await say({
            text: '❌ Could not fetch PR details. Please check the PR reference.',
            thread_ts: threadTs
          });
        }
      } else {
        // Send help message
        await say({
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '👋 *Hi! I\'m the PR Approval Bot*\n\n' +
                      'Reply to a message containing a PR reference and mention me with `approve` to approve it.\n\n' +
                      '*Usage:*\n' +
                      '• Reply to a PR message: `approve @bot` or `@bot approve`\n' +
                      '• Or mention me directly: `@bot approve owner/repo#123`\n\n' +
                      '*Supported formats:*\n' +
                      '• GitHub URL: `https://github.com/owner/repo/pull/123`\n' +
                      '• Reference: `owner/repo#123`\n' +
                      '• PR number: `#123` (requires DEFAULT_REPO env var)'
              }
            }
          ],
          text: 'PR Approval Bot Help',
          thread_ts: threadTs
        });
      }
    }
  } catch (error) {
    console.error('Error handling app mention:', error);
    
    // Handle channel_not_found errors when trying to send messages
    if (error.data && error.data.error === 'channel_not_found') {
      console.error('Cannot send message: bot does not have access to channel');
      console.error('Please invite the bot to the channel: /invite @bot-name');
      // Don't try to send error message if we can't access the channel
      return;
    }
    
    // Try to send error message, but handle errors gracefully
    try {
      await say({
        text: `❌ Error processing request: ${error.message}`,
        thread_ts: threadTs
      });
    } catch (sayError) {
      console.error('Failed to send error message:', sayError.message);
    }
  }
});

// Handle slash command
app.command('/approve-pr', async ({ command, ack, say }) => {
  await ack();
  
  try {
    const text = command.text.trim();
    
    if (!text) {
      await say({
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Please provide a PR reference.*\n\n' +
                    '*Usage:*\n' +
                    '`/approve-pr https://github.com/owner/repo/pull/123`\n' +
                    '`/approve-pr owner/repo#123`'
            }
          }
        ],
        text: 'Usage: /approve-pr [PR reference]'
      });
      return;
    }
    
    const prInfo = prBot.extractPRInfo(text);
    
    if (prInfo) {
      await handlePRCommand(prInfo, say);
    } else {
      await say({
        text: '❌ Invalid PR reference format. Please use a valid GitHub PR URL or reference.'
      });
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    
    // Handle channel_not_found errors when trying to send messages
    if (error.data && error.data.error === 'channel_not_found') {
      console.error('Cannot send message: bot does not have access to channel');
      console.error('Please invite the bot to the channel: /invite @bot-name');
      return;
    }
    
    // Try to send error message, but handle errors gracefully
    try {
      await say({
        text: `❌ Error processing command: ${error.message}`
      });
    } catch (sayError) {
      console.error('Failed to send error message:', sayError.message);
    }
  }
});

// Shared function to handle PR commands
async function handlePRCommand(prInfo, say, threadTs = null) {
  try {
    // Get PR details
    const prDetails = await prBot.getPRDetails(prInfo);
    
    if (prDetails) {
      const messageOptions = {
        blocks: prBot.formatPRDetails(prDetails),
        text: `PR: ${prDetails.title}`
      };
      
      if (threadTs) {
        messageOptions.thread_ts = threadTs;
      }
      
      try {
        await say(messageOptions);
      } catch (sayError) {
        if (sayError.data && sayError.data.error === 'channel_not_found') {
          throw sayError; // Re-throw to be handled by caller
        }
        console.error('Error sending PR details:', sayError.message);
      }
      
      // Send processing message
      const processingOptions = {
        text: '⏳ Processing approval request...'
      };
      
      if (threadTs) {
        processingOptions.thread_ts = threadTs;
      }
      
      try {
        await say(processingOptions);
      } catch (sayError) {
        if (sayError.data && sayError.data.error === 'channel_not_found') {
          throw sayError; // Re-throw to be handled by caller
        }
        console.error('Error sending processing message:', sayError.message);
      }
      
      // Approve the PR
      const result = await prBot.approvePR(prInfo);
      
      const resultOptions = {
        text: result.success ? `✅ ${result.message}` : `❌ ${result.message}`
      };
      
      if (result.success) {
        resultOptions.blocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *${result.message}*`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '🔗 View PR'
                },
                style: 'primary',
                url: prBot.getPRUrl(prInfo)
              }
            ]
          }
        ];
      }
      
      if (threadTs) {
        resultOptions.thread_ts = threadTs;
      }
      
      try {
        await say(resultOptions);
      } catch (sayError) {
        if (sayError.data && sayError.data.error === 'channel_not_found') {
          throw sayError; // Re-throw to be handled by caller
        }
        console.error('Error sending result message:', sayError.message);
      }
    } else {
      const errorOptions = {
        text: '❌ Could not fetch PR details. Please check the PR reference.'
      };
      
      if (threadTs) {
        errorOptions.thread_ts = threadTs;
      }
      
      try {
        await say(errorOptions);
      } catch (sayError) {
        if (sayError.data && sayError.data.error === 'channel_not_found') {
          throw sayError; // Re-throw to be handled by caller
        }
        console.error('Error sending error message:', sayError.message);
      }
    }
  } catch (error) {
    // Re-throw channel_not_found errors to be handled by caller
    if (error.data && error.data.error === 'channel_not_found') {
      throw error;
    }
    // Log other errors
    console.error('Error in handlePRCommand:', error.message);
    throw error;
  }
}

// Error handling
app.error(async (error) => {
  console.error('Slack app error:', error);
  
  // Provide more context for channel errors
  if (error.data && error.data.error === 'channel_not_found') {
    console.error('Channel access error details:');
    console.error('- The bot may not have access to the channel');
    console.error('- The bot may need to be invited to the channel: /invite @bot-name');
    console.error('- The channel may be a private channel requiring explicit invitation');
    console.error('- Check that the bot has the "channels:history" scope in Slack app settings');
  }
});

// Start the app
(async () => {
  // Check required environment variables
  const requiredVars = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'GITHUB_TOKEN'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.log('\n📋 Required environment variables:');
    console.log('SLACK_BOT_TOKEN: Your Slack bot token (xoxb-...)');
    console.log('SLACK_APP_TOKEN: Your Slack app token (xapp-...)');
    console.log('SLACK_SIGNING_SECRET: Your Slack signing secret');
    console.log('GITHUB_TOKEN: Your GitHub personal access token');
    console.log('DEFAULT_REPO (optional): Default repository (owner/repo format)');
    process.exit(1);
  }
  
  await app.start();
  console.log('⚡️ Slack PR Approval Bot is running!');
  console.log('📝 Mention the bot in a thread with a PR reference to approve it.');
  console.log('💡 Or use /approve-pr command directly.');
})();