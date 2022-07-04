require('dotenv').config();
const { env } = process;

if(!env.npm_config_skip_prompt) {
  const reader = require("readline-sync");
  const prompt = reader.question("The test suite will delete all open chat channels, conversations and tasks. Would you like to continue? ");
  if(prompt.toLowerCase() != "y")
    process.exit();
}

const TEST_CHANNEL_SMS = (env.npm_config_channel == "sms"); // if not we assume chat.

const client              = require("twilio")(env.ACCOUNT_SID, env.AUTH_TOKEN);
const frClient            = require("twilio")(env.FRONTLINE_ACCOUNT_SID, env.FRONTLINE_AUTH_TOKEN);

const webchat             = require('./webchat.js');
const flex                = require('./flex.js');
const frontline           = require('./frontline.js');
const helpers             = require('./helpers/functions.js');
const testWorkerName      = 'nkhurana';
const availableActivity   = "Available";
const unAvailableActivity = "Unavailable";
const agentChatMessage      = "Message from agent via Chat Channel.";
const agentFrontlineMessage = "Message from agent via Frontline.";

let session, conversation, participants, channel, members, flexMessages, frontlineMessages;
const tests = [];

const sleep = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function loadResources() {
  channel = null;
  channel = await helpers.findChatChannel(client, env.CHAT_SERVICE_SID);
  members = null;
  members = await helpers.getChatChannelMembers(client, channel);
  conversation = null;
  conversation = await helpers.findConversation(frClient, testWorkerName);
  participants = null;
  participants = await helpers.getConversationParticipants(frClient, conversation);
}

async function loadMessageResources() {
  flexMessages = null;
  flexMessages = await helpers.loadChatMessages(client, channel);
  frontlineMessages = null;
  frontlineMessages = await helpers.loadConversationMessages(frClient, conversation);
}

async function startTestSession(sleepDelay) {
  await helpers.cleanupResources(client, frClient, env.WORKSPACE_SID, env.CHAT_SERVICE_SID, testWorkerName);

  if(!TEST_CHANNEL_SMS)
    session = await webchat.loadAndStartChatAsUser();

  await sleep(sleepDelay); // give it 5 seconds for data to replicate into both systems.

  await loadResources();
}

async function endTestSession() {
  if(!TEST_CHANNEL_SMS)
    await webchat.closeBrowserSession(session.browser, session.page);

  await helpers.cleanupResources(client, frClient, env.WORKSPACE_SID, env.CHAT_SERVICE_SID, testWorkerName);
}

tests.push(async function() {
  console.log("Testing interaction with agent online and auto accept enabled. Smoothest route.");

  // ensure agent is online.
  await helpers.setAgentStatus(client, env.WORKSPACE_SID, testWorkerName, availableActivity);

  await startTestSession(5000);

  // run the tests.
  await flex.testChatChannelExists(channel);
  await flex.testChatChannelHasConversation(channel);
  await flex.testIfChatChannelHasAgent(members);
  await frontline.testConversationExists(frClient, testWorkerName);
  await frontline.testIfConversationHasAgent(participants)

  // post a message to the chat channel
  await helpers.postMessageToChatChannel(client, channel, testWorkerName, agentChatMessage);

  await sleep(2000);

  // reload the message resources
  await loadMessageResources();
  await frontline.testIfConversationHasMessages(frontlineMessages);
  await frontline.testIfMessageExistsInConversation(frontlineMessages, agentChatMessage);

  // post a message to frontline
  await helpers.postMessageToConversation(frClient, conversation, testWorkerName, agentFrontlineMessage);

  await sleep(2000);

  // reload messages
  await loadMessageResources();
  await frontline.testIfMessageExistsInConversation(frontlineMessages, agentFrontlineMessage);

  await endTestSession();
});

tests.push(async function() {
  console.log("Testing interaction with agent offline to start the chat.");

  // set agent to unavailable
  await helpers.setAgentStatus(client, env.WORKSPACE_SID, testWorkerName, unAvailableActivity);

  await startTestSession(1000);

  // run the tests.
  await flex.testChatChannelExists(channel);
  await flex.testIfChatChannelDoesNotHaveAgent(members);
  await frontline.testConversationDoesNotExist(conversation);

  await helpers.setAgentStatus(client, env.WORKSPACE_SID, testWorkerName, availableActivity);

  await sleep(5000);

  await loadResources();

  // run tests again
  await flex.testChatChannelExists(channel);
  await flex.testChatChannelHasConversation(channel);
  await flex.testIfChatChannelHasAgent(members);
  await frontline.testConversationExists(frClient, testWorkerName);
  await frontline.testIfConversationHasAgent(participants)

  await endTestSession();
});

(async function() {
  for(const i in tests) await tests[i]();
})()
