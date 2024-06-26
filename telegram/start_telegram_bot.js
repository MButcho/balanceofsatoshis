const {actOnMessageReply} = require('ln-telegram');
const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncForever = require('async/forever');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {getForwards} = require('ln-service');
const {getNetwork} = require('ln-service');
const {getTransactionRecord} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {handleBackupCommand} = require('ln-telegram');
const {handleBalanceCommand} = require('ln-telegram');
const {handleBlocknotifyCommand} = require('ln-telegram');
const {handleButtonPush} = require('ln-telegram');
const {handleConnectCommand} = require('ln-telegram');
const {handleCostsCommand} = require('ln-telegram');
const {handleEarningsCommand} = require('ln-telegram');
const {handleEditedMessage} = require('ln-telegram');
const {handleGraphCommand} = require('ln-telegram');
const {handleInfoCommand} = require('ln-telegram');
const {handleInvoiceCommand} = require('ln-telegram');
const {handleLiquidityCommand} = require('ln-telegram');
const {handleMempoolCommand} = require('ln-telegram');
const {handlePayCommand} = require('ln-telegram');
const {handlePendingCommand} = require('ln-telegram');
const {handleStartCommand} = require('ln-telegram');
const {handleStopCommand} = require('ln-telegram');
const {handleVersionCommand} = require('ln-telegram');
const {InputFile} = require('grammy');
const {isMessageReplyAction} = require('ln-telegram');
const {noLocktimeIdForTransaction} = require('@alexbosworth/blockchain');
const {notifyOfForwards} = require('ln-telegram');
const {postChainTransaction} = require('ln-telegram');
const {postClosedMessage} = require('ln-telegram');
const {postClosingMessage} = require('ln-telegram');
const {postCreatedTrade} = require('ln-telegram');
const {postOpenMessage} = require('ln-telegram');
const {postOpeningMessage} = require('ln-telegram');
const {postNodesOnline} = require('ln-telegram');
const {postSettledInvoice} = require('ln-telegram');
const {postSettledPayment} = require('ln-telegram');
const {postSettledTrade} = require('ln-telegram');
const {postUpdatedBackup} = require('ln-telegram');
const {returnResult} = require('asyncjs-util');
const {serviceAnchoredTrades} = require('paid-services');
const {subscribeToBackups} = require('ln-service');
const {subscribeToBlocks} = require('goldengate');
const {subscribeToChannels} = require('ln-service');
const {subscribeToInvoices} = require('ln-service');
const {subscribeToPastPayments} = require('ln-service');
const {subscribeToPendingChannels} = require('ln-sync');
const {subscribeToTransactions} = require('ln-service');

const getNodeDetails = require('./get_node_details');
const interaction = require('./interaction');
const named = require('./../package').name;
const {version} = require('./../package');

const fileAsDoc = file => new InputFile(file.source, file.filename);
const fromName = node => `${node.alias} ${node.public_key.substring(0, 8)}`;
const getLnds = (x, y, z) => getNodeDetails({logger: x, names: y, nodes: z});
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const isHash = n => /^[0-9A-F]{64}$/i.test(n);
let isBotInit = false;
const isNumber = n => !isNaN(n);
const limit = 99999;
const markdown = {parse_mode: 'Markdown'};
const maxCommandDelayMs = 1000 * 10;
const restartSubscriptionTimeMs = 1000 * 30;
const sanitize = n => (n || '').replace(/_/g, '\\_').replace(/[*~`]/g, ''); 

// Added by MB
const { execSync } = require('child_process');
const { readFileSync, unlinkSync } = require('fs');

const { allowed_user } = require('./config.json');
const allowed_user_err = [401, 'Unauthorized Access'];
var Promise = require('bluebird');
const max_chars = 1024 // Max chars per Telegram message (Normal user: 1024 / Premium user: 2048)
//const markup = {parse_mode: 'MarkdownV2'};
const markup = {parse_mode: 'HTML'};

/** Start a Telegram bot

  {
    ask: <Ask Function>
    bot: <Telegram Bot Object>
    [id]: <Authorized User Id Number>
    key: <Telegram API Key String>
    [min_forward_tokens]: <Minimum Forward Tokens To Notify Number>
    [min_rebalance_tokens]: <Minimum Rebalance Tokens To Notify Number>
    lnds: [<Authenticated LND API Object>]
    nodes: [<Saved Nodes String>]
    logger: <Winston Logger Object>
    payments_limit: <Total Spendable Budget Tokens Limit Number>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    [connected]: <Connected User Id Number>
    failure: <Termination Error Object>
  }
*/
module.exports = (args, cbk) => {
  let connectedId = args.id;
  let isStopped = false;
  let paymentsLimit = args.payments_limit;
  const subscriptions = [];

  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToStartTelegramBot']);
        }

        if (!isArray(args.lnds) || !args.lnds.length) {
          return cbk([400, 'ExpectedLndsToStartTelegramBot']);
        }

        if (!args.key) {
          return cbk([400, 'ExpectedApiKeyToStartTelegramBot']);
        }

        if (!!args.id && args.key.startsWith(`${args.id}:`)){
          return cbk([400, 'ExpectedConnectCodeFromConnectCommandNotBotId']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToStartTelegramBot']);
        }

        if (!isArray(args.nodes)) {
          return cbk([400, 'ExpectedArrayOfSavedNodesToStartTelegramBot']);
        }

        if (!isNumber(args.payments_limit)) {
          return cbk([400, 'ExpectedPaymentsLimitTokensNumberToStartBot']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestMethodToStartTelegramBot']);
        }

        return cbk();
      },
      
      // Get node info
      getNodes: ['validate', ({}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => {
          return getWalletInfo({lnd}, (err, res) => {
            if (!!err) {
              return cbk([503, 'FailedToGetNodeInfo', {err}]);
            }

            const named = fromName({
              alias: res.alias,
              public_key: res.public_key,
            });

            return cbk(null, {
              lnd,
              alias: res.alias,
              from: sanitize(named),
              public_key: res.public_key,
            });
          });
        },
        cbk);
      }],

      // Setup the bot start action
      initBot: ['getNodes', ({getNodes}, cbk) => {
        // Exit early when the bot was already setup
        if (!!isBotInit) {
          return cbk();
        }

        const names = getNodes.map(node => ({
          alias: node.alias,
          from: node.from,
          public_key: node.public_key,
        }));

        args.bot.catch(err => args.logger.error({telegram_error: err}));

        // Catch message editing
        args.bot.use(async (ctx, next) => {
          try {
            await handleEditedMessage({ctx});
          } catch (err) {
            args.logger.error({err});
          }

          return next();
        });
        
        /*---------------------------------------------------------------------------------*/
        // functions to send multiple messages in sequence by MB
        function sendMessages(ctx, messages) {
          //console.log(messages.length)
          return Promise.mapSeries(messages, function(message) {
            return ctx.reply(message, markup);            
          });
        }
        
        function prepareMessages(ctx, output, count) {
          let output_l = [];
          if (output.length > max_chars) {
            let out_arr = output.split("\n")
            let temp_output = "";
            out_arr.forEach(_output => {
              if ((_output.length + temp_output.length + 8) < max_chars) {
                temp_output += _output + "\n";
              } else {
                output_l.push(temp_output);
                temp_output = _output + "\n";
              }
            });
            output_l.push(temp_output);            
          } else {
            output_l.push(output);            
          }
          if (count != 0 && output_l.length > count) {
            output_l.length = count;
            for (let i = 0; i < output_l.length; i++) {
                if (i < output_l.length) {
                  output_l[i] += '... more';
                }
            }
            
          }
          sendMessages(ctx, output_l, count);
        }
        
        function log_error(ctx, user_command) {
          user_from = ctx.message.from;
          allowed_user_err.splice(allowed_user_err.indexOf("Unauthorized Access"), 1, "Unauthorized /" + user_command + " [FN: " + user_from.first_name + ", LN: " + user_from.last_name + ", UN: @" + user_from.username + ", ID: " + user_from.id + ")]");
          args.logger.error({allowed_user_err});
          prepareMessages(ctx, "You do not have rights to use this bot and your ID " + user_from.id + " was logged!", 0);
        }
        
        // custom commands by MB
        args.bot.command('channels', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/data/rebalance-lnd/rebalance.py -c -g').toString();
            try {
              prepareMessages(ctx, output, 0);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "channels");
          }
        });
        
        args.bot.command('disk', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/data/rebalance-lnd/custom.py -t disk').toString();
            //output = execSync('df -h').toString().split('\n')[2];

            try {
              prepareMessages(ctx, output, 0);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "disk");
          }
        });
        
        args.bot.command('earn', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/data/rebalance-lnd/custom.py -t earn').toString();
            //output = execSync('df -h').toString().split('\n')[2];

            try {
              prepareMessages(ctx, output, 1);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "earn");
          }
        });
        
        args.bot.command('estimate', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/data/rebalance-lnd/custom.py -t estimatefee').toString();
            //output = execSync('df -h').toString().split('\n')[2];

            try {
              prepareMessages(ctx, output, 0);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "estimate");
          }
        });
        
        args.bot.command('forwards', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/data/rebalance-lnd/rebalance.py -c -w -g').toString();
            //output = execSync('df -h').toString().split('\n')[2];

            try {
              prepareMessages(ctx, output, 1);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "forwards");
          }
        });
        
        args.bot.command('htlcs', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/data/rebalance-lnd/custom.py -t htlcs -l').toString();

            try {
              prepareMessages(ctx, output, 1);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "htlcs");
          }
        });
        
        args.bot.command('running', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/data/rebalance-lnd/custom.py -t bos -l').toString();

            try {
              prepareMessages(ctx, output, 1);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "running");
          }
        });
        
        args.bot.command('rebalances', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/data/rebalance-lnd/custom.py -t rebalances -s -d 7').toString();

            try {
              prepareMessages(ctx, output, 1);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "rebalances");          
          }
        });
        
        args.bot.command('reconnect', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = await execSync('/data/rebalance-lnd/custom.py -t reconnect').toString();

            try {
              prepareMessages(ctx, output, 0);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "reconnect");
          }
        });
        
        args.bot.command('updates', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            var output = execSync('/usr/local/bin/lncli listchannels | jq -r \'.[][] | [.num_updates, .peer_alias] | @tsv\' | sort -rn').toString();

            try {
              prepareMessages(ctx, output, 0);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "updates");
          }
        });
        
        /*---------------------------------------------------------------------------------*/
        
        // Handle command to get backups
        args.bot.command('backup', async ctx => {
          try {
            await handleBackupCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              reply: ctx.reply,
              send: (n, opts) => ctx.replyWithDocument(fileAsDoc(n), opts),
            });
          } catch (err) {
            //args.logger.error({err});
            log_error(ctx, "backup");
          }
        });

        // Handle lookup of total funds
        args.bot.command('balance', async ctx => {
          try {
            await handleBalanceCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              reply: (n, opt) => ctx.reply(n, opt),
              working: () => ctx.replyWithChatAction('typing'),
            });
          } catch (err) {
            //args.logger.error({err});
            log_error(ctx, "balance");
          }
        });

        // Handle command to get notified on the next block
        args.bot.command('blocknotify', ctx => {
          handleBlocknotifyCommand({
            from: ctx.message.from.id,
            id: connectedId,
            reply: n => ctx.reply(n, markdown),
            request: args.request,
          },
          err => !!err ? log_error(ctx, "blocknotify") : null);
        });
        
        // Handle command to get the connect id
        args.bot.command('connect', ctx => {
          handleConnectCommand({
            from: ctx.from.id,
            id: connectedId,
            reply: n => ctx.reply(n, markdown),
          });
        });

        // Handle command to view costs over the past week
        /*args.bot.command('costs', async ctx => {
          try {
            await handleCostsCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              reply: n => ctx.reply(n, markdown),
              request: args.request,
              working: () => ctx.replyWithChatAction('typing'),
            });
          } catch (err) {
            args.logger.error({err});
          }
        });*/
        
        // Handle command to view earnings over the past week
        /* args.bot.command('earnings', async ctx => {
          try {
            await handleEarningsCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              reply: n => ctx.reply(n, markdown),
              working: () => ctx.replyWithChatAction('typing'),
            });
          } catch (err) {
            args.logger.error({err});
          }
        }); */

        // Handle command to look up nodes in the graph
        /*args.bot.command('graph', async ctx => {
          try {
            await handleGraphCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              remove: () => ctx.deleteMessage(),
              reply: (message, options) => ctx.reply(message, options),
              text: ctx.message.text,
              working: () => ctx.replyWithChatAction('typing'),
            });
          } catch (err) {
            args.logger.error({err});
          }
        });*/

        // Handle command to look up wallet info
        args.bot.command('info', async ctx => {
          try {
            await handleInfoCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              remove: () => ctx.deleteMessage(),
              reply: (message, options) => ctx.reply(message, options),
            });
          } catch (err) {
            //args.logger.error({err});
            log_error(ctx, "info");
          }
        });

        // Handle creation of an invoice
        args.bot.command('invoice', async ctx => {
          try {
            await handleInvoiceCommand({
              ctx,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              request: args.request,
            });
          } catch (err) {
            //args.logger.error({err});
            log_error(ctx, "invoice");
          }
        });

        // Handle lookup of the mempool
        args.bot.command('mempool', async ctx => {
          try {
            return await handleMempoolCommand({
              from: ctx.message.from.id,
              id: connectedId,
              reply: n => ctx.reply(n, markdown),
              request: args.request,
            });
          } catch (err) {
            //args.logger.error({err});
            log_error(ctx, "mempool");
          }
        });

        // Handle lookup of channel liquidity
        args.bot.command('liquidity', async ctx => {
          try {
            await asyncRetry({
              errorFilter: err => {
                if (err && /^404/.test(err.message)) {
                  return false;
                }

                return true;
              },
            }, async () => {
              await handleLiquidityCommand({
                from: ctx.message.from.id,
                id: connectedId,
                nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
                reply: (n, opt) => ctx.reply(n, opt),
                text: ctx.message.text,
                working: () => ctx.replyWithChatAction('typing'),
              });
            });
          } catch (err) {
            //args.logger.error({err});
            log_error(ctx, "liquidity");
          }
        });

        // Handle command to pay a payment request
        /*args.bot.command('pay', async ctx => {
          const budget = paymentsLimit;

          if (!budget) {
            ctx.reply(interaction.pay_budget_depleted);

            return;
          }

          // Stop budget while payment is in flight
          paymentsLimit = 0;

          try {
            const {tokens} = await handlePayCommand({
              budget,
              from: ctx.message.from.id,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              reply: message => ctx.reply(message, markdown),
              request: args.request,
              text: ctx.message.text,
            });

            // Set the payments limit to the amount unspent by the pay command
            paymentsLimit = budget - tokens;
          } catch (err) {
            args.logger.error({payment_error: err});
          }
        });*/

        // Handle command to view pending transactions
        args.bot.command('pending', async ctx => {
          try {
            await handlePendingCommand({
              from: ctx.message.from.id,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
              reply: (message, options) => ctx.reply(message, options),
              working: () => ctx.replyWithChatAction('typing'),
            });
          } catch (err) {
            //args.logger.error({err});
            log_error(ctx, "pending");
          }
        });
        
        // Handle command to start the bot
        args.bot.command('start', ctx => {
          handleStartCommand({
            id: connectedId,
            reply: n => ctx.reply(n, markdown),
          });
        });
        
        // Handle command to start the bot
        args.bot.command('start', ctx => {
          handleStartCommand({
            id: connectedId,
            reply: n => ctx.reply(n, markdown),
          });
        });

        // Terminate the running bot
        /*args.bot.command('stop', async ctx => {
          try {
            await handleStopCommand({
              from: ctx.message.from.id,
              id: connectedId,
              reply: (msg, mode) => ctx.reply(msg, mode),
            });
          } catch (err) {
            args.logger.error({err});
          }
        });*/

        // Handle command to view the current version
        args.bot.command('version', async ctx => {
          try {
            await handleVersionCommand({
              named,
              version,
              from: ctx.message.from.id,
              id: connectedId,
              request: args.request,
              reply: n => ctx.reply(n, markdown),
            });
          } catch (err) {
            //args.logger.error({err});
            log_error(ctx, "version");
          }          
        });

        // Handle command to get help with the bot
        args.bot.command('help', async ctx => {
          if (ctx.message.from.id == allowed_user) {
            const commands = [
              '/backup - Get node backup file',
              '/blocknotify - Notification on next block',
              '/channels - Show list of channels',
              '/connect - Connect bot',
              //'/costs - View costs over the past week',
              '/disk - Show free disk space',
              '/earn - Show earnings over the past week',
              '/estimate - Show BTC fee estimate',
              //'/earnings - View earnings over the past week',
              '/forwards - Show forwards for the past 24 hours',
              //'/graph <pubkey or peer alias> - Show info about a node',
              '/htlcs - Show pending HTLCs',
              '/info - Show wallet info',
              '/invoice [amount] [memo] - Make an invoice',
              '/liquidity [with] - View node liquidity',
              '/mempool - BTC mempool report',
              //'/pay - Pay an invoice',
              '/pending - Show pending channels, probes, and forwards',
              '/reconnect - Run bos reconnect',
              '/rebalances - Show summary of rebalances for last 7 days',
              '/running - Show running bos rebalances',
              //'/stop - Stop bot',
              '/updates - Show channels with the most updates',
              '/version - View the current bot version',
            ];

            try {
              await ctx.reply(`🤖\n${commands.join('\n')}`);
            } catch (err) {
              args.logger.error({err});
            }
          } else {
            log_error(ctx, "help");
            //await ctx.reply("Missing rights");
          }
        });

        // Handle button push type commands
        args.bot.on('callback_query:data', async ctx => {
          try {
            await handleButtonPush({
              ctx,
              bot: args.bot,
              id: connectedId,
              nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
            });
          } catch (err) {
            args.logger.error({err});
          }
        });

        // Listen for replies to created invoice messages
        args.bot.on('message').filter(
          ctx => isMessageReplyAction({ctx, nodes: getNodes}),
          async ctx => {
            try {
              return await actOnMessageReply({
                ctx,
                api: args.bot.api,
                id: connectedId,
                nodes: (await getLnds(args.logger, names, args.nodes)).nodes,
                request: args.request,
              });
            } catch (err) {
              args.logger.error({err});
            }
          },
        );

        args.bot.start();

        // Avoid re-registering bot actions
        isBotInit = true;

        return cbk();
      }],

      // Ask the user to confirm their user id
      userId: ['initBot', ({}, cbk) => {
        // Exit early when the id is specified
        if (!!connectedId) {
          return cbk();
        }

        return args.ask({
          message: interaction.user_id_prompt.message,
          name: 'code',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // The connect code should be entirely numeric, not an API key
            if (!isNumber(input)) {
              return `Expected numeric connect code from /connect command`;
            }

            // the connect code number should not match bot id from the API key
            if (args.key.startsWith(`${input}:`)) {
              return `Expected /connect code, not bot id from API key`;
            }

            return true;
          },
        },
        ({code}) => {
          if (!code) {
            return cbk([400, 'ExpectedConnectCodeToStartTelegramBot']);
          }

          connectedId = Number(code);

          return cbk();
        });
      }],

      // Setup the bot commands
      setCommands: ['validate', async ({}) => {
        return await args.bot.api.setMyCommands([
          {command: 'backup', description: 'Get node backup file'},
          {command: 'balance', description: 'Show funds on the node'},
          {command: 'blocknotify', description: 'Get notified on next block'},
          {command: 'channels', description: 'Show list of channels'},
          //{command: 'connect', description: 'Get connect code for the bot'},
          //{command: 'costs', description: 'Show costs over the week'},
          {command: 'disk', description: 'Show free disk space of node'},
          {command: 'earn', description: 'Show earnings over the week'},
          {command: 'estimate', description: 'Show BTC fee estimate'},
          //{command: 'earnings', description: 'Show earnings over the week'},
          {command: 'forwards', description: 'Show forwards for the past 24 hours'},
          //{command: 'graph', description: 'Show info about a node'},
          {command: 'htlcs', description: 'Show pending HTLCs'},
          {command: 'help', description: 'Show the list of commands'},
          {command: 'info', description: 'Show wallet info'},
          {command: 'invoice', description: 'Create an invoice [amt] [memo]'},
          {command: 'liquidity', description: 'Get liquidity [with-peer]'},
          {command: 'mempool', description: 'Get info about the mempool'},
          //{command: 'pay', description: 'Pay a payment request'},
          {command: 'pending', description: 'Show pending forwards, channels'},
          {command: 'rebalances', description: 'Show summary of rebalances for last 7 days'},
          {command: 'reconnect', description: 'Run bos reconnect'},
          {command: 'running', description: 'Show running bos rebalances'},
          //{command: 'stop', description: 'Stop the bot'},
          {command: 'updates', description: 'Show channels with the most updates'},
          {command: 'version', description: 'View current bot version'},
        ]);
      }],

      // Subscribe to backups
      backups: ['getNodes', 'userId', ({getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          let postBackupTimeoutHandle;
          const sub = subscribeToBackups({lnd: node.lnd});

          subscriptions.push(sub);

          sub.on('backup', ({backup}) => {
            // Cancel pending backup notification when there is a new backup
            if (!!postBackupTimeoutHandle) {
              clearTimeout(postBackupTimeoutHandle);
            }

            // Time delay backup posting to avoid posting duplicate messages
            postBackupTimeoutHandle = setTimeout(() => {
              return postUpdatedBackup({
                backup,
                id: connectedId,
                key: args.key,
                node: {alias: node.alias, public_key: node.public_key},
                send: (id, n) => args.bot.api.sendDocument(id, fileAsDoc(n)),
              },
              err => !!err ? args.logger.error({post_backup_err: err}) : null);
            },
            restartSubscriptionTimeMs);

            return;
          });

          sub.once('error', err => {
            // Terminate subscription and restart after a delay
            sub.removeAllListeners();

            return cbk([503, 'ErrorInBackupsSub', {err}]);
          });
        },
        cbk);
      }],

      // Channel status changes
      channels: ['getNodes', 'userId', ({getNodes}, cbk) => {
        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          const sub = subscribeToChannels({lnd});

          subscriptions.push(sub);

          sub.on('channel_closed', async update => {
            try {
              await postClosedMessage({
                from,
                lnd,
                capacity: update.capacity,
                id: connectedId,
                is_breach_close: update.is_breach_close,
                is_cooperative_close: update.is_cooperative_close,
                is_local_force_close: update.is_local_force_close,
                is_remote_force_close: update.is_remote_force_close,
                partner_public_key: update.partner_public_key,
                send: (id, msg, opt) => args.bot.api.sendMessage(id, msg, opt),
              });
            } catch (err) {
              args.logger.error({from, post_closed_message_error: err});
            }
          });

          sub.on('channel_opened', async update => {
            try {
              await postOpenMessage({
                from,
                lnd,
                capacity: update.capacity,
                id: connectedId,
                is_partner_initiated: update.is_partner_initiated,
                is_private: update.is_private,
                partner_public_key: update.partner_public_key,
                send: (id, msg, opt) => args.bot.api.sendMessage(id, msg, opt),
              });
            } catch (err) {
              args.logger.error({from, post_open_message_error: err});
            }
          });

          sub.once('error', err => {
            // Terminate subscription and restart after a delay
            sub.removeAllListeners();

            return cbk([503, 'UnexpectedErrorInChannelsSubscription', {err}]);
          });

          return;
        },
        cbk);
      }],

      // Send connected message
      connected: ['getNodes', 'userId', ({getNodes}, cbk) => {
        args.logger.info({is_connected: true});

        return postNodesOnline({
          id: connectedId,
          nodes: getNodes.map(n => ({alias: n.alias, id: n.public_key})),
          send: (id, msg, opt) => args.bot.api.sendMessage(id, msg, opt),
        },
        cbk);
      }],

      // Poll for forwards
      forwards: ['getNodes', 'userId', ({getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          let after = new Date().toISOString();
          const {from} = node;
          const {lnd} = node;

          return asyncForever(cbk => {
            if (isStopped) {
              return cbk([503, 'ExpectedNonStoppedBotToReportForwards']);
            }

            const before = new Date().toISOString();

            return getForwards({after, before, limit, lnd}, (err, res) => {
              // Exit early and ignore errors
              if (!!err) {
                return setTimeout(cbk, restartSubscriptionTimeMs);
              }

              // Push cursor forward
              after = before;

              // Notify Telegram bot that forwards happened
              return notifyOfForwards({
                from,
                lnd,
                forwards: res.forwards.filter(forward => {
                  if (!args.min_forward_tokens) {
                    return true;
                  }

                  return forward.tokens >= args.min_forward_tokens;
                }),
                id: connectedId,
                node: node.public_key,
                nodes: getNodes,
                send: (id, msg, opt) => args.bot.api.sendMessage(id, msg, opt),
              },
              err => {
                if (!!err) {
                  args.logger.error({forwards_notify_err: err});
                }

                return setTimeout(cbk, restartSubscriptionTimeMs);
              });
            });
          },
          cbk);
        },
        cbk);
      }],

      // Subscribe to invoices
      invoices: ['getNodes', 'userId', ({getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          const sub = subscribeToInvoices({lnd: node.lnd});

          subscriptions.push(sub);

          sub.on('invoice_updated', invoice => {
            // Exit early when an invoice has no associated hash
            if (!isHash(invoice.id)) {
              return;
            }

            return postSettledInvoice({
              from: node.from,
              id: connectedId,
              invoice: {
                confirmed_at: invoice.confirmed_at,
                description: invoice.description,
                id: invoice.id,
                is_confirmed: invoice.is_confirmed,
                is_push: invoice.is_push,
                payments: invoice.payments,
                received: invoice.received,
                received_mtokens: invoice.received_mtokens,
              },
              key: node.public_key,
              lnd: node.lnd,
              min_rebalance_tokens: args.min_rebalance_tokens,
              nodes: getNodes,
              quiz: ({answers, correct, question}) => {
                return args.bot.api.sendQuiz(
                  connectedId,
                  question,
                  answers,
                  {correct_option_id: correct},
                );
              },
              send: (id, msg, opts) => args.bot.api.sendMessage(id, msg, opts),
            },
            err => !!err ? args.logger.error({settled_err: err}) : null);
          });

          sub.on('error', err => {
            const from = node.from;

            sub.removeAllListeners();

            args.logger.error({invoices_err: err});

            return cbk([503, 'InvoicesSubscriptionFailed', {err, from}]);
          });
        },
        cbk);
      }],

      // Subscribe to past payments
      payments: ['getNodes', 'userId', ({getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          const sub = subscribeToPastPayments({lnd: node.lnd});

          subscriptions.push(sub);

          sub.on('payment', async payment => {
            // Ignore rebalances
            if (payment.destination === node.public_key) {
              return;
            }

            try {
              await postSettledPayment({
                from: node.from,
                id: connectedId,
                lnd: node.lnd,
                nodes: getNodes.map(n => n.public_key),
                payment: {
                  destination: payment.destination,
                  id: payment.id,
                  paths: payment.paths,
                  safe_fee: payment.safe_fee,
                  safe_tokens: payment.safe_tokens,
                },
                send: (id, m, opts) => args.bot.api.sendMessage(id, m, opts),
              });
            } catch (err) {
              args.logger.error({post_payment_error: err});
            }
          });

          sub.once('error', err => {
            // Terminate subscription and restart after a delay
            sub.removeAllListeners();

            return cbk([503, 'ErrorInPaymentsSub', {err}])
          });
        },
        cbk);
      }],

      // Pending channels changes
      pending: ['getNodes', 'userId', ({getNodes}, cbk) => {
        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          const sub = subscribeToPendingChannels({lnd});

          subscriptions.push(sub);

          // Listen for pending closing channel events
          sub.on('closing', async update => {
            try {
              await postClosingMessage({
                from,
                lnd,
                closing: update.channels,
                id: connectedId,
                nodes: getNodes,
                send: (id, msg, opt) => args.bot.api.sendMessage(id, msg, opt),
              });
            } catch (err) {
              args.logger.error({from, post_closing_message_error: err});
            }
          });

          // Listen for pending opening events
          sub.on('opening', async update => {
            try {
              await postOpeningMessage({
                from,
                lnd,
                id: connectedId,
                opening: update.channels,
                send: (id, msg, opt) => args.bot.api.sendMessage(id, msg, opt),
              });
            } catch (err) {
              args.logger.error({from, post_opening_message_error: err});
            }
          });

          sub.once('error', err => {
            // Terminate subscription and restart after a delay
            sub.removeAllListeners();

            return cbk([503, 'UnexpectedErrorInPendingSubscription', {err}]);
          });

          return;
        },
        cbk);
      }],

      // Service trade secrets
      secrets: ['getNodes', 'userId', ({getNodes}, cbk) => {
        return asyncEach(getNodes, (node, cbk) => {
          const start = new Date().toISOString();

          const sub = serviceAnchoredTrades({
            lnd: node.lnd,
            request: args.request,
          });

          subscriptions.push(sub);

          sub.on('settled', async trade => {
            // Ignore trades without tokens
            if (!trade.tokens) {
              return;
            }

            try {
              await postSettledTrade({
                api: args.bot.api,
                description: trade.description,
                destination: node.public_key,
                lnd: node.lnd,
                nodes: getNodes,
                to: trade.to,
                tokens: trade.tokens,
                user: connectedId,
              });
            } catch (err) {
              args.logger.error({err});
            }
          });

          sub.on('start', async trade => {
            // Exit early when this is an older trade or has no tokens
            if (!trade.tokens || trade.created_at < start) {
              return;
            }

            try {
              await postCreatedTrade({
                api: args.bot.api,
                description: trade.description,
                destination: node.public_key,
                expires_at: trade.expires_at,
                id: trade.id,
                lnd: node.lnd,
                nodes: getNodes,
                tokens: trade.tokens,
                user: connectedId,
              });
            } catch (err) {
              args.logger.error({err});
            }
          });

          sub.once('error', err => {
            sub.removeAllListeners();

            args.logger.error({err});

            return cbk(err);
          });

          return;
        },
        cbk);
      }],

      // Subscribe to chain transactions
      transactions: ['getNodes', 'userId', ({getNodes}, cbk) => {
        let isFinished = false;

        return asyncEach(getNodes, ({from, lnd}, cbk) => {
          const noLocktimeIds = [];
          const sub = subscribeToTransactions({lnd});
          const transactions = [];

          subscriptions.push(sub);

          sub.on('chain_transaction', async transaction => {
            const {id} = transaction;

            // Exit early when this pending transaction has already been seen
            if (!transaction.is_confirmed && transactions.includes(id)) {
              return;
            }

            transactions.push(id);

            // Check the transaction uniqueness against a locktime-absent hash
            if (!transaction.is_confirmed && !!transaction.transaction) {
              try {
                const buffer = hexAsBuffer(transaction.transaction);

                const noLocktimeId = noLocktimeIdForTransaction({buffer}).id;

                // Exit early when a similar transaction has already been seen
                if (noLocktimeIds.includes(noLocktimeId)) {
                  return;
                }

                noLocktimeIds.push(noLocktimeId);
              } catch (err) {
                args.logger.error({err});
              }
            }

            try {
              const record = await getTransactionRecord({lnd, id});

              if (!record || !record.tx) {
                return;
              }

              return await postChainTransaction({
                from,
                confirmed: transaction.is_confirmed,
                id: connectedId,
                nodes: getNodes,
                send: (id, msg, opt) => args.bot.api.sendMessage(id, msg, opt),
                transaction: record,
              });
            } catch (err) {
              args.logger.error({chain_tx_err: err, node: from});

              if (!!isFinished) {
                return;
              }

              isFinished = true;

              sub.removeAllListeners({});

              return cbk(err);
            }
          });

          sub.once('error', err => {
            sub.removeAllListeners();

            if (!!isFinished) {
              return;
            }

            isFinished = true;

            args.logger.error({from, chain_subscription_error: err});

            return cbk(err);
          });

          return;
        },
        cbk);
      }],
    },
    (err, res) => {
      // Signal to fetch based polling that it should stop
      isStopped = true;

      // Cancel all open subscriptions
      subscriptions.forEach(n => n.removeAllListeners());

      const result = {result: {connected: connectedId, failure: err}};

      return returnResult({reject, resolve, of: 'result'}, cbk)(null, result);
    });
  });
};
