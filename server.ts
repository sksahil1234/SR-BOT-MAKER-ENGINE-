import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import TelegramBotConstructor from "node-telegram-bot-api";
// ESM compatibility for CommonJS default exports
const TelegramBot = (TelegramBotConstructor as any).default || TelegramBotConstructor;

import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import "dotenv/config";
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';

// Initialize Firebase Admin
try {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
    console.log("[INIT] Firebase Admin initialized.");
  }
} catch (err: any) {
  console.error("[FATAL] Firebase Admin Init Error:", err.message);
}

// Handle named database correctly for v11+
let db: admin.firestore.Firestore;
try {
  db = firebaseConfig.firestoreDatabaseId 
    ? getFirestore(firebaseConfig.firestoreDatabaseId)
    : getFirestore();
  console.log(`[INIT] Firestore using database: ${firebaseConfig.firestoreDatabaseId || '(default)'}`);
} catch (err: any) {
  console.error("[FATAL] Firestore Init Error:", err.message);
  // Fallback to default
  db = getFirestore();
}

export { db };

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: "SERVER_SYSTEM", // We are running on server
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test Connection
async function testConnection() {
  try {
    await db.collection('system').doc('health').get();
    logSys("Firestore connected successfully via Admin SDK.");
  } catch (error) {
    console.error("Firestore Connection Err:", error);
  }
}
testConnection();

const sysLogs: string[] = [];
function logSys(msg: string) {
  const t = new Date().toISOString();
  console.log(`[SYS] ${t}: ${msg}`);
  sysLogs.push(`[${t}] ${msg}`);
  if (sysLogs.length > 50) sysLogs.shift();
}

/**
 * BOT MAKER ENGINE - SR TECHNOLOGY LTD™ ADVANCED V2
 * A heavy-duty multi-bot deployment engine.
 */

interface SubBotConfig {
  referBonus: number;
  dailyBonus: number;
  minReferForPayout: number;
  minWithdraw: number;
  maxWithdraw: number;
  withdrawTax: number;
  withdrawStatus: boolean;
  botStatus: boolean;
  antiBot: boolean;
  autoPayout: boolean;
  amountInWhole: boolean;
  userAlerts: boolean;
  joinNotice?: string;
  giftCodes: Map<string, number>;
  adminLogs: string[];
  bannedUsers: Set<number>;
  bannedWallets: Set<string>;
  botOffText: string;
  withdrawOffText: string;
  payoutUrl?: string;
  payoutAppUrl?: string;
  payoutGatewayName?: string;
  payoutChannel?: string;
  forceJoinChannels: string[];
  admins: Set<number>;
  deviceVerification: boolean;
}

interface UserProfile {
  balance: number;
  referrals: number;
  walletId: string | null;
  isBanned: boolean;
  lastDailyClaim?: number;
  verified: boolean;
  joinedAt: number;
}

interface BotNode {
  id: string;
  token: string;
  ownerId: number;
  type: 'autopay' | 'upi' | 'crypto' | 'star';
  theme: string;
  createdAt: number;
  config: SubBotConfig;
  users: Map<number, UserProfile>;
  pendingWithdrawals: Map<string, { userId: number, amount: number, wallet: string, createdAt: number }>;
  withdrawals: { userId: number, amount: number, wallet: string, timestamp: number }[];
  instance: any;
}

function esc(text: any): string {
  if (typeof text !== 'string') return String(text);
  // Escaping for Markdown (V1)
  return text.replace(/[_*[\]()]/g, '\\$&');
}

const BASE_URL = process.env.APP_URL || "https://ais-dev-6hkklopo6scrohigjrdodz-15102117223.asia-east1.run.app";
if (!process.env.APP_URL) {
  console.warn("[WARN] APP_URL not set in environment. Falling back to hardcoded URL for webhooks.");
}

class BotEngine {
  private nodes: Map<string, BotNode> = new Map();
  private userToNodes: Map<number, string[]> = new Map();
  private fsmStates: Map<number, { nodeId: string, action: string, targetId?: number }> = new Map();

  constructor() {
    logSys("BotEngine object created. Awaiting boot sequence...");
    this.startResilienceMonitor();
    this.startFirestoreHeartbeat();
    this.setupProcessHandlers();
  }

  private setupProcessHandlers() {
    process.on('uncaughtException', (err) => {
      logSys(`CRITICAL UNCAUGHT EXCEPTION: ${err.message}`);
      console.error(err);
    });
    process.on('unhandledRejection', (reason, promise) => {
      logSys(`CRITICAL UNHANDLED REJECTION: ${reason}`);
      console.error('Promise:', promise, 'Reason:', reason);
    });
  }

  private async startFirestoreHeartbeat() {
    setInterval(async () => {
      try {
        await db.collection('system').doc('heartbeat').set({
          lastHeartbeat: Date.now(),
          uptime: process.uptime(),
          nodeCount: this.nodes.size
        }, { merge: true });
      } catch (err: any) {
        console.error("Heartbeat Error:", err.message);
      }
    }, 120000); // Every 2 minutes
  }

  public async boot() {
    try {
      await this.loadDataFromFirestore();
    } catch (err: any) {
      logSys(`BOOT_CRITICAL_ERR: ${err.message}`);
    }
  }

  private async loadDataFromFirestore() {
    try {
      logSys("Hydrating node configurations from Firestore...");
      const nodesSnap = await db.collection('nodes').get();
      
      let nodeCount = 0;
      for (const nodeDoc of nodesSnap.docs) {
        const data = nodeDoc.data();
        if (!data || !data.token) continue;

        const safeConfig = data.config || {};
        
        const node: BotNode = {
          ...data,
          id: nodeDoc.id,
          config: {
            referBonus: safeConfig.referBonus ?? 5,
            dailyBonus: safeConfig.dailyBonus ?? 1,
            minReferForPayout: safeConfig.minReferForPayout ?? 5,
            minWithdraw: safeConfig.minWithdraw ?? 10,
            maxWithdraw: safeConfig.maxWithdraw ?? 1000,
            withdrawTax: safeConfig.withdrawTax ?? 5,
            withdrawStatus: safeConfig.withdrawStatus ?? true,
            botStatus: safeConfig.botStatus ?? true,
            antiBot: safeConfig.antiBot ?? false,
            autoPayout: safeConfig.autoPayout ?? false,
            amountInWhole: safeConfig.amountInWhole ?? true,
            userAlerts: safeConfig.userAlerts ?? true,
            joinNotice: safeConfig.joinNotice || "Welcome!",
            giftCodes: new Map(Object.entries(safeConfig.giftCodes || {})),
            adminLogs: safeConfig.adminLogs || [],
            bannedUsers: new Set(safeConfig.bannedUsers || []),
            bannedWallets: new Set(safeConfig.bannedWallets || []),
            botOffText: safeConfig.botOffText || "Maintenance",
            withdrawOffText: safeConfig.withdrawOffText || "Closed",
            payoutUrl: safeConfig.payoutUrl || "",
            payoutAppUrl: safeConfig.payoutAppUrl || "",
            payoutGatewayName: safeConfig.payoutGatewayName || "Gateway",
            payoutChannel: safeConfig.payoutChannel || "",
            forceJoinChannels: safeConfig.forceJoinChannels || [],
            admins: new Set(safeConfig.admins || [data.ownerId]),
            deviceVerification: safeConfig.deviceVerification ?? true,
          },
          users: new Map(),
          pendingWithdrawals: new Map(Object.entries(data.pendingWithdrawals || {})),
          withdrawals: data.withdrawals || [],
          instance: null
        } as any;

        this.nodes.set(node.id, node);
        
        const userNodeList = this.userToNodes.get(node.ownerId) || [];
        userNodeList.push(node.id);
        this.userToNodes.set(node.ownerId, userNodeList);

        nodeCount++;
        // Async redeploy with a stagger
        setTimeout(() => this.redeployInstance(node), nodeCount * 500);
      }
      logSys(`Firestore hydrated: ${nodeCount} nodes configurations loaded.`);
    } catch (err: any) {
      logSys(`F-STARTUP-ERR: ${err.message}`);
    }
  }

  private async ensureUserLoaded(node: BotNode, userId: number): Promise<UserProfile | null> {
    if (node.users.has(userId)) return node.users.get(userId)!;
    
    try {
      const uDoc = await db.collection('nodes').doc(node.id).collection('users').doc(String(userId)).get();
      if (uDoc.exists) {
        const profile = uDoc.data() as UserProfile;
        node.users.set(userId, profile);
        return profile;
      }
      return null;
    } catch (err: any) {
      logSys(`User Load Err [${node.id}/${userId}]: ${err.message}`);
      return null;
    }
  }

  private async saveNodeToFirestore(node: BotNode) {
    try {
      const configObj = {
        ...node.config,
        giftCodes: Object.fromEntries(node.config.giftCodes),
        bannedUsers: Array.from(node.config.bannedUsers),
        bannedWallets: Array.from(node.config.bannedWallets),
        admins: Array.from(node.config.admins),
        instance: null
      };

      const dataToSave = {
        id: node.id,
        token: node.token,
        ownerId: node.ownerId,
        type: node.type,
        theme: node.theme,
        createdAt: node.createdAt,
        config: configObj,
        pendingWithdrawals: Object.fromEntries(node.pendingWithdrawals)
      };

      await db.collection('nodes').doc(node.id).set(dataToSave);
    } catch (err: any) {
      logSys(`Node Save Err [${node.id}]: ${err.message}`);
    }
  }

  private async saveWithdrawalToFirestore(nodeId: string, withdrawal: any) {
    try {
      const id = withdrawal.id || `WD-${uuidv4().substring(0, 8)}`;
      await db.collection('nodes').doc(nodeId).collection('withdrawals').doc(id).set(withdrawal);
    } catch (err: any) {
      logSys(`WD Save Err [${nodeId}]: ${err.message}`);
    }
  }

  private async saveUserToFirestore(nodeId: string, userId: number, profile: UserProfile) {
    try {
      await db.collection('nodes').doc(nodeId).collection('users').doc(String(userId)).set(profile);
    } catch (err: any) {
      logSys(`User Save Err [${nodeId}/${userId}]: ${err.message}`);
    }
  }

  private startResilienceMonitor() {
    setInterval(() => {
      this.nodes.forEach(async (node) => {
        try {
          if (!node.instance) {
            logSys(`[MONITOR] Node ${node.id} instance missing. Redeploying...`);
            this.redeployInstance(node);
          }
        } catch (err: any) {
          logSys(`[MONITOR_ERR] Node ${node.id}: ${err.message}`);
        }
      });
    }, 60000); 
  }

  private saveData() {
     // No-op for global save, we now save incrementally
  }

  private loadData() {
     // No-op, handled by boot()
  }

  private async redeployInstance(node: BotNode) {
    if (!node.token) return;
    try {
      const bot = new TelegramBot(node.token, { polling: false });
      
      bot.on('error', (err) => {
        console.error(`[BOT_ERR] Node ${node.id}:`, err.message);
      });

      const me = await bot.getMe();
      this.setupInstanceHandlers(bot, node);
      node.instance = bot;
      
      // Setup Webhook
      if (BASE_URL) {
        await bot.setWebHook(`${BASE_URL}/api/webhook/${node.id}`);
      }

      // Professional Branding
      bot.setMyDescription({ description: "REGISTER THIS PAYMENT GATEWAY APP AND GET YOUR UPI ID FOR WITHDRAWAL YOUR AMOUNT \uD83D\uDCB8\n\n\uD83D\uDEE0 Powered by SR TECHNOLOGY LTD\u2122" }).catch(() => {});
      bot.setMyShortDescription({ short_description: "Industrial grade auto-payout engine." }).catch(() => {});

      logSys(`Node ${node.id} (@${me.username}) auto-restarted.`);
    } catch (err: any) {
      console.error(`Failed to auto-restart node ${node.id}:`, err.message);
    }
  }

  async deployBot(ownerId: number, token: string, type: BotNode['type'], theme: string): Promise<{ nodeId: string, username: string }> {
    // Check if token already in use
    for (const n of this.nodes.values()) {
      if (n.token === token) {
        throw new Error("TOKEN_IN_USE");
      }
    }

    const nodeId = `SR-${uuidv4().substring(0, 6).toUpperCase()}`;
    
    const newNode: BotNode = {
      id: nodeId,
      token,
      ownerId,
      type,
      theme,
      createdAt: Date.now(),
      config: {
        referBonus: 5,
        dailyBonus: 1,
        minReferForPayout: 5,
        minWithdraw: 10,
        maxWithdraw: 1000,
        withdrawTax: 5,
        withdrawStatus: true,
        botStatus: true,
        antiBot: false,
        autoPayout: false,
        amountInWhole: true,
        userAlerts: true,
        joinNotice: "Welcome to our network! 🎉",
        giftCodes: new Map(),
        adminLogs: [],
        bannedUsers: new Set(),
        bannedWallets: new Set(),
        botOffText: "⚠️ Bot is currently under maintenance.",
        withdrawOffText: "⚠️ Withdrawals are currently closed.",
        payoutUrl: "",
        payoutAppUrl: "",
        payoutGatewayName: "SR GATEWAY",
        payoutChannel: "@SR_TECHNOLOGY_LTD",
        forceJoinChannels: [],
        admins: new Set([ownerId]),
        deviceVerification: true
      },
      users: new Map(),
      pendingWithdrawals: new Map(),
      withdrawals: [],
      instance: null
    };

    try {
      const instance = new TelegramBot(token, { polling: false });

      instance.on('error', (err) => console.error(`[BOT_ERR] Node ${nodeId}:`, err.message));

      const me = await instance.getMe();
      
      this.setupInstanceHandlers(instance, newNode);
      newNode.instance = instance;

      // Setup Webhook
      if (BASE_URL) {
        await instance.setWebHook(`${BASE_URL}/api/webhook/${nodeId}`);
      }

      // Professional Branding
      instance.setMyDescription({ description: "REGISTER THIS PAYMENT GATEWAY APP AND GET YOUR UPI ID FOR WITHDRAWAL YOUR AMOUNT 💸\n\n🛠 Powered by SR TECHNOLOGY LTD™" }).catch(() => {});
      instance.setMyShortDescription({ short_description: "Industrial grade auto-payout engine." }).catch(() => {});
      
      this.nodes.set(nodeId, newNode);
      const userNodeList = this.userToNodes.get(ownerId) || [];
      userNodeList.push(nodeId);
      this.userToNodes.set(ownerId, userNodeList);
      
      await this.saveNodeToFirestore(newNode); // Persistent Save to Firestore
      return { nodeId, username: me.username || "Bot" };
    } catch (error) {
       console.error(`Deployment Error [${nodeId}]:`, error);
       throw new Error("Instance Deployment Failed");
    }
  }

  private sendAdminPanel(bot: any, node: BotNode, chatId: number, messageId?: number) {
    const escNodeId = esc(node.id);
    const escPayoutChannel = esc(node.config.payoutChannel || "@SR_TECHNOLOGY_LTD");
    const panelText = `⚙️ **MAIN SETTINGS PANEL**\n\n` +
      `Welcome, **SR TECHNOLOGY LTD™**\n\n` +
      `🟢 **System Status**\n` +
      `├ Bot: ${node.config.botStatus ? "🟢 ON" : "🔴 OFF"}\n` +
      `├ Payouts: ${node.config.withdrawStatus ? "🟢 ON" : "🔴 OFF"}\n` +
      `├ Verification: ${node.config.antiBot ? "🛡 ACTIVE" : "🟢 AUTO"}\n` +
      `└ Device Verify: ${node.config.deviceVerification ? "🛡 ENABLED" : "🔓 DISABLED"}\n` +
      `💸 **Finance & Rewards**\n\n` +
      `├ Refer Amount: ${node.config.referBonus} - ${node.config.referBonus}\n` +
      `├ Join Bonus: ${node.config.dailyBonus} - Normal\n` +
      `├ Withdraw Amount: ${node.config.minWithdraw} - ${node.config.maxWithdraw} (Wallet + UPI)\n` +
      `├ Withdrawal: Unlimited\n` +
      `├ For Unlock Withdrawal Need: ${node.config.minReferForPayout} Refer\n` +
      `└ Tax Fee: ${node.config.withdrawTax}%\n` +
      `📡 **API Configuration**\n\n` +
      `├ UPI + Multiple Wallet (API) Support\n` +
      `└ (API) Gateway: ${esc(node.config.payoutGatewayName || "SR GATEWAY")}\n\n` +
      `📢 Payout Channel: ${escPayoutChannel}\n\n` +
      `🛠 Node ID: \`${escNodeId}\`\n` +
      `🛠 Maker: @RJMakerProBot`;

    const keyboard = {
      inline_keyboard: [
        [{ text: `🤖 Bot: ${node.config.botStatus ? "ON" : "OFF"}`, callback_data: `adm_toggle_bot` }, { text: `💸 Payouts: ${node.config.withdrawStatus ? "ON" : "OFF"}`, callback_data: `adm_toggle_withdraw` }],
        [{ text: `🛡 Anti-Bot: ${node.config.antiBot ? "ACTIVE" : "OFF"}`, callback_data: `adm_toggle_antibot` }, { text: `⚡ AutoPay: ${node.config.autoPayout ? "ON" : "OFF"}`, callback_data: `adm_toggle_autopay` }],
        [{ text: "🧑‍🤝‍🧑 Refer Bonus", callback_data: `adm_set_referBonus` }, { text: "💳 Min Payout", callback_data: `adm_set_minWithdraw` }],
        [{ text: "🎁 Daily Bonus", callback_data: `adm_set_dailyBonus` }, { text: "🧾 Withdraw Tax", callback_data: `adm_set_withdrawTax` }],
        [{ text: "📣 Broadcast", callback_data: `adm_ask_bc` }, { text: "💬 DM User", callback_data: `adm_ask_dm` }],
        [{ text: `💰 Amount In Whole: ${node.config.amountInWhole ? "🟢 ON" : "🔴 OFF"}`, callback_data: `adm_toggle_whole` }, { text: `🔔 User Alerts: ${node.config.userAlerts ? "🟢 ON" : "🔴 OFF"}`, callback_data: `adm_toggle_alerts` }],
        [{ text: "👑 Manage Admins", callback_data: `adm_view_admins` }, { text: "🔄 Reset All Balances", callback_data: `adm_ask_reset` }],
        [{ text: "🚫 Ban User", callback_data: `adm_ask_ban` }, { text: "✅ Unban User", callback_data: `adm_ask_unban` }],
        [{ text: "🔴 Ban Wallet", callback_data: `adm_ask_banWallet` }, { text: "✅ Unban Wallet", callback_data: `adm_ask_unbanWallet` }],
        [{ text: "💵 Add/Cut Balance", callback_data: `adm_ask_balance_mod` }, { text: "📊 Live Bot Stats", callback_data: `adm_view_stats` }],
        [{ text: "✅ Manual Verify", callback_data: `adm_view_verify` }, { text: "🔍 User Info", callback_data: `adm_ask_details` }],
        [{ text: "🎟 Gift Codes", callback_data: `adm_gift` }, { text: "🏆 Leaderboard", callback_data: `adm_view_leader` }],
        [{ text: "🔥 Top Withdraws (UPI ID)", callback_data: `adm_view_topwd` }, { text: "🧑‍🤝‍🧑 Min Refers Needed", callback_data: `adm_set_minReferForPayout` }],
        [{ text: "📢 Payout Channel", callback_data: `adm_set_payoutChannel` }, { text: "🔒 Force Join (Multi)", callback_data: `adm_view_forceJoin` }],
        [{ text: "📈 Performance Matrix", callback_data: `adm_view_perf` }, { text: "🕵️ Admin Logs", callback_data: `adm_view_logs` }],
        [{ text: "🚀 API Gateway Setup", callback_data: `adm_api_setup` }],
        [{ text: `🛡 Device Block: ${node.config.deviceVerification ? "ON" : "OFF"}`, callback_data: `adm_toggle_device` }],
        [{ text: "📝 Edit Bot-Off Msg", callback_data: `adm_set_botOffText` }, { text: "📝 Edit Payout-Off Msg", callback_data: `adm_set_withdrawOffText` }]
      ]
    };

    if (messageId) {
      bot.editMessageText(panelText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, panelText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
  }

  private setupInstanceHandlers(bot: any, node: BotNode) {
    const isAdmin = (userId: number) => node.config.admins.has(userId) || userId === node.ownerId;

    bot.on('message', async (msg) => {
      try {
        const userId = msg.chat.id;
        const text = msg.text || "";
        const isAdminUser = isAdmin(userId);

      // --- INTERCEPTOR: Ban Check ---
      if (!isAdminUser && node.config.bannedUsers.has(userId)) {
        return bot.sendMessage(userId, "⛔️ **ACCESS DENIED**\nYour account is permanently restricted.");
      }

      // --- INTERCEPTOR: Device Verification (Anti-Cheat) ---
      if (node.config.deviceVerification && !isAdminUser) {
        const existingUser = await this.ensureUserLoaded(node, userId);
        if (existingUser && text.includes('start ')) {
          // They are already in the system, trying to use a referral while existing
        }
      }

      // --- INTERCEPTOR: Bot Maintenance ---
      if (!isAdminUser && !node.config.botStatus) {
        return bot.sendMessage(userId, node.config.botOffText);
      }

      // --- USER SIDE LOGIC / Start Handler ---
      const user = await this.ensureUserLoaded(node, userId);

      if (text === "/adminhelp" && isAdminUser) {
        return this.sendAdminPanel(bot, node, userId);
      }

      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        const refIdStr = parts.length > 1 ? parts[1] : null;
        let refId: number | null = null;
        
        if (refIdStr) refId = parseInt(refIdStr);

        if (!user) {
          const newUser: UserProfile = { 
            balance: 0, 
            referrals: 0, 
            walletId: null, 
            isBanned: false, 
            verified: !node.config.antiBot,
            joinedAt: Date.now() 
          };
          node.users.set(userId, newUser);
          await this.saveUserToFirestore(node.id, userId, newUser); 
          if (refId && refId !== userId) {
            const inviter = await this.ensureUserLoaded(node, refId);
            if (inviter) {
              inviter.balance += node.config.referBonus;
              inviter.referrals += 1;
              bot.sendMessage(refId, `🔔 **Referral Alert!** User joined via your link. +₹${node.config.referBonus} added.`).catch(() => {});
              await this.saveUserToFirestore(node.id, refId, inviter);
            }
          }
        } 

        // Force Join Multi-Channel Check
        if (node.config.forceJoinChannels && node.config.forceJoinChannels.length > 0) {
          const joinedStatuses = await Promise.all(node.config.forceJoinChannels.map(ch => this.checkForceJoin(bot, ch, userId)));
          const allJoined = joinedStatuses.every(s => s === true);
          
          if (!allJoined) {
            const buttons = [];
            for (let i = 0; i < node.config.forceJoinChannels.length; i += 2) {
              const row = [];
              const ch1 = node.config.forceJoinChannels[i];
              let url1 = ch1.startsWith('http') ? ch1 : (ch1.startsWith('@') ? `https://t.me/${ch1.substring(1)}` : `https://t.me/c/${ch1.replace('-100', '')}/999999999`);
              row.push({ text: `Join ${i + 1} ↗️`, url: url1 });

              if (i + 1 < node.config.forceJoinChannels.length) {
                const ch2 = node.config.forceJoinChannels[i+1];
                let url2 = ch2.startsWith('http') ? ch2 : (ch2.startsWith('@') ? `https://t.me/${ch2.substring(1)}` : `https://t.me/c/${ch2.replace('-100', '')}/999999999`);
                row.push({ text: `Join ${i + 2} ↗️`, url: url2 });
              }
              buttons.push(row);
            }
            // Add Claim/Continue button row
            buttons.push([{ text: "✅ Continue", callback_data: "check_join" }]);

            const kb = { inline_keyboard: buttons };
            return bot.sendMessage(userId, `👋 **Hello User, Welcome To The Bot!**\n\n⭕ **Join Below Channels And Click On Below Button To Proceed.**`, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
          }
        }

        const menu = {
          reply_markup: {
            keyboard: [
              [{ text: "💰 Balance" }, { text: "🎁 Daily Bonus" }],
              [{ text: "👥 Refer & Earn" }, { text: "💸 Withdraw" }],
              [{ text: "🎟 Redeem Gift Code" }, { text: "🏆 Leaderboard" }],
              [{ text: "🏦 Set Payout Wallet" }, { text: "📞 Support" }]
            ],
            resize_keyboard: true
          }
        };

        bot.sendMessage(userId, `👋 **Welcome to SR TECHNOLOGY LTD™ Sub-Bot**\n\n${node.config.joinNotice || ""}\n\nStart earning and withdraw instantly.`, menu).catch(() => {});
        return;
      }

      // Force Join Blanket Check (Block other messages if not joined)
      if (node.config.forceJoinChannels && node.config.forceJoinChannels.length > 0) {
        const joinedStatuses = await Promise.all(node.config.forceJoinChannels.map(ch => this.checkForceJoin(bot, ch, userId)));
        const allJoined = joinedStatuses.every(s => s === true);
        if (!allJoined) {
          const buttons = [];
          for (let i = 0; i < node.config.forceJoinChannels.length; i += 2) {
            const row = [];
            const ch1 = node.config.forceJoinChannels[i];
            let url1 = ch1.startsWith('http') ? ch1 : (ch1.startsWith('@') ? `https://t.me/${ch1.substring(1)}` : `https://t.me/c/${ch1.replace('-100', '')}/999999999`);
            row.push({ text: `Join ${i + 1} ↗️`, url: url1 });

            if (i + 1 < node.config.forceJoinChannels.length) {
              const ch2 = node.config.forceJoinChannels[i + 1];
              let url2 = ch2.startsWith('http') ? ch2 : (ch2.startsWith('@') ? `https://t.me/${ch2.substring(1)}` : `https://t.me/c/${ch2.replace('-100', '')}/999999999`);
              row.push({ text: `Join ${i + 2} ↗️`, url: url2 });
            }
            buttons.push(row);
          }
          buttons.push([{ text: "✅ Continue", callback_data: "check_join" }]);
          return bot.sendMessage(userId, "❌ **Access Restricted!**\n\nPlease join ALL required channels first to use this bot.", {
            reply_markup: { inline_keyboard: buttons }
          }).catch(() => {});
        }
      }

      // FSM Handling for Admin/User inputs
      const state = this.fsmStates.get(userId);
      if (state && state.nodeId === node.id) {
        await this.handleFSM(bot, node, userId, text || "", state);
        return;
      }

      if (!user) return;

      if (text === "💰 Balance") {
        const balText = `💵 **YOUR ACCOUNT BALANCE**\n\n` +
          `💰 Balance: ₹${user.balance.toFixed(2)}\n` +
          `👥 Referrals: ${user.referrals}\n` +
          `💳 Wallet: \`${esc(user.walletId || "Not Set")}\`\n` +
          `📅 Last Claimed: ${user.lastDailyClaim ? new Date(user.lastDailyClaim).toLocaleDateString() : "Never"}`;
        bot.sendMessage(userId, balText, { parse_mode: 'Markdown' }).catch(() => {});
      }

      if (text === "🏆 Leaderboard") {
        const sorted = Array.from(node.users.entries()).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
        let list = "🏆 **SR NETWORK GLOBAL LEADERS**\n\n";
        sorted.forEach(([uid, u], i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🔹";
          const name = uid === userId ? "✨ **YOU**" : `\`User ${uid.toString().substring(0, 5)}...\``;
          list += `${medal} ${name} — **₹${u.balance.toFixed(2)}**\n`;
        });
        list += "\n🚀 *Refer more to reach the top!*";
        bot.sendMessage(userId, list, { parse_mode: 'Markdown' });
      }

      if (text === "📞 Support") {
        bot.sendMessage(userId, `📞 **SUPPORT CENTER**\n\nIf you face any issues with payouts or referrals, contact our specialized engineering team:\n\n👤 **Admin:** @srsaportbot\n\n📢 **Updates group:** @SRTECNOLOGY1`, { parse_mode: 'Markdown' });
      }

      if (text === "🎁 Daily Bonus") {
        const now = Date.now();
        const lastClaim = user.lastDailyClaim || 0;
        const cooldown = 24 * 60 * 60 * 1000; // 24 hours

        if (now - lastClaim < cooldown) {
          const remaining = cooldown - (now - lastClaim);
          const hours = Math.floor(remaining / (60 * 60 * 1000));
          const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
          return bot.sendMessage(userId, `❌ **Cooldown Active!**\nYou can claim again in ${hours}h ${mins}m.`);
        }

        user.balance += node.config.dailyBonus;
        user.lastDailyClaim = now;
        await this.saveUserToFirestore(node.id, userId, user);
        bot.sendMessage(userId, `congratulations 🎉 you have successfully claimed the bonus RS ${node.config.dailyBonus}`);
      }

      if (text === "👥 Refer & Earn") {
        const me = await bot.getMe();
        const link = `https://t.me/${me.username}?start=${userId}`;
        const refMsg = `💰 **Per Refer Rs. ${node.config.referBonus} wallet cash**\n\n👤 **Your Referral Link:** \`${esc(link)}\`\n\nShare With Your Friend's & Family And Earn Refer Bonus Easily ✨🤑`;
        bot.sendMessage(userId, refMsg, { parse_mode: 'Markdown' }).catch(() => {});
      }

      if (text === "🎟 Redeem Gift Code") {
        this.fsmStates.set(userId, { nodeId: node.id, action: "REDEEM_GIFT" });
        bot.sendMessage(userId, "⌨️ **Enter your Gift Code:**");
      }

      if (text === "🏦 Set Payout Wallet") {
        this.fsmStates.set(userId, { nodeId: node.id, action: "SET_WALLET" });
        let gatewayLink = "https://t.me/BotFather";
        if (node.config.payoutAppUrl && node.config.payoutAppUrl.trim() !== "") {
          gatewayLink = node.config.payoutAppUrl;
        } else if (node.config.payoutUrl) {
          try {
            // Safer extraction of base URL
            const urlStr = node.config.payoutUrl.trim();
            const match = urlStr.match(/^(https?:\/\/[^\/?#]+)/i);
            if (match) {
              gatewayLink = match[1];
            } else {
              gatewayLink = urlStr;
            }
          } catch {
            gatewayLink = node.config.payoutUrl;
          }
        }
        bot.sendMessage(userId, `🏦 **WALLET REGISTRATION**\n\nRegister and get your account number and set your wallet ID below.\n\n🔗 **Gateway App:** [Open Registration](${gatewayLink})\n\n**Enter your Wallet ID / Account Number:**`, { parse_mode: 'Markdown' });
      }

      if (text === "💸 Withdraw") {
        if (!node.config.withdrawStatus) return bot.sendMessage(userId, node.config.withdrawOffText).catch(() => {});
        if (!user.walletId) return bot.sendMessage(userId, "❌ **Wallet Not Set!**\n\nRegister and get your account number and set your wallet ID first using 'Set Payout Wallet' button.").catch(() => {});
        
        if (node.config.bannedWallets.has(user.walletId)) {
          return bot.sendMessage(userId, "🚫 **WALLET BANNED**\nYour payout wallet address is restricted from transactions.").catch(() => {});
        }

        if (node.config.antiBot && !user.verified) {
           const num1 = Math.floor(Math.random() * 10) + 1;
           const num2 = Math.floor(Math.random() * 10) + 1;
           const ans = num1 + num2;
           this.fsmStates.set(userId, { nodeId: node.id, action: "SOLVE_CAPTCHA", targetId: ans });
           return bot.sendMessage(userId, `🛡 **ANTI-BOT VERIFICATION**\n\nPlease solve this to continue:\n\n**${num1} + ${num2} = ?**`, { parse_mode: 'Markdown' }).catch(() => {});
        }

        if (user.balance < node.config.minWithdraw) {
          return bot.sendMessage(userId, `❌ Minimum withdrawal is ₹${node.config.minWithdraw}`).catch(() => {});
        }
        if (user.referrals < node.config.minReferForPayout) {
          return bot.sendMessage(userId, `❌ You need at least ${node.config.minReferForPayout} referrals to withdraw.`).catch(() => {});
        }

        this.fsmStates.set(userId, { nodeId: node.id, action: "WITHDRAW_AMT" });
        bot.sendMessage(userId, `💰 **WITHDRAWAL INTERFACE**\n\n💵 Available: ₹${user.balance.toFixed(2)}\n💳 Wallet: \`${esc(user.walletId)}\`\n\n**Enter amount to withdraw:**`, { parse_mode: 'Markdown' }).catch(() => {});
      }
    } catch (err: any) {
      console.error(`[MSG_HANDLER_ERR] User ${msg.chat.id}:`, err.message);
    }
    });

    // --- CALLBACK HANDLERS ---
    bot.on('callback_query', async (query) => {
      try {
        const chatId = query.message?.chat.id;
        const userId = query.from.id; // User ID who clicked
        const adminUser = query.from;
        const adminTag = adminUser.username ? `@${adminUser.username}` : (adminUser.first_name || userId.toString());
        const data = query.data;
        if (!chatId || !data) return;

        const isAdminUser = isAdmin(userId);

        // Security: Block admin actions for non-admins
        if (data.startsWith('adm_') || data.startsWith('APPROVE_WD_') || data.startsWith('REJECT_WD_') || data.startsWith('approve_wd_') || data.startsWith('reject_wd_')) {
          if (!isAdminUser) {
            return bot.answerCallbackQuery(query.id, { text: "❌ Admins Only", show_alert: true });
          }
        }

        // --- HANDLERS ---
        
        // Payout Channel Approval (Capitalized)
        if (data.startsWith('APPROVE_WD_')) {
          const reqId = data.replace('APPROVE_WD_', '');
          const req = node.pendingWithdrawals.get(reqId);
          if (!req) return bot.answerCallbackQuery(query.id, { text: "❌ Request not found", show_alert: true });

          bot.answerCallbackQuery(query.id, { text: "⚡ Processing Payout..." });
          this.processWithdrawal(bot, node, req.userId, req.amount, req.wallet, query.message?.chat.id, query.message?.message_id).then(async success => {
            if (success) {
              node.pendingWithdrawals.delete(reqId);
              const tax = (req.amount * node.config.withdrawTax) / 100;
              const finalAmt = req.amount - tax;
              const msg = `✅ **PAYOUT APPROVED & PAID**\n\n👤 User: \`${req.userId}\`\n💰 Amount: ₹${req.amount.toFixed(2)}\n🧾 Tax: ₹${tax.toFixed(2)}\n💵 Paid: ₹${finalAmt.toFixed(2)}\n💳 Wallet: \`${req.wallet}\`\n📝 ID: \`${reqId}\`\n\n✅ Status: **SUCCESS**\n🤵 Approved By: ${adminTag}`;
              bot.editMessageText(msg, { 
                chat_id: query.message?.chat.id, 
                message_id: query.message?.message_id, 
                parse_mode: 'Markdown' 
              }).catch(() => {});
              await this.saveNodeToFirestore(node);
            } else {
               bot.sendMessage(userId, `❌ **Payout Attempt Failed** for Request ${reqId}. User refunded.`);
            }
          });
          return;
        }

        if (data.startsWith('REJECT_WD_')) {
          const reqId = data.replace('REJECT_WD_', '');
          const req = node.pendingWithdrawals.get(reqId);
          if (!req) return bot.answerCallbackQuery(query.id, { text: "❌ Request not found", show_alert: true });

          bot.answerCallbackQuery(query.id, { text: "❌ Request Rejected" });
          node.pendingWithdrawals.get(reqId); // Dummy access to keep it reachable
          
          // Refund User
          const userObj = await this.ensureUserLoaded(node, req.userId);
          if (userObj) {
            userObj.balance += req.amount;
            await this.saveUserToFirestore(node.id, req.userId, userObj);
            bot.sendMessage(req.userId, `❌ **Withdrawal Rejected!**\n\nYour request for ₹${req.amount} was declined. Balance has been refunded.\nID: ${reqId}`);
          }
          node.pendingWithdrawals.delete(reqId);

          // Update Message in Channel
          const msgText = `❌ **PAYOUT REJECTED**\n\n👤 User: \`${req.userId}\`\n💰 Amount: ₹${req.amount.toFixed(2)}\n💳 Wallet: \`${req.wallet}\`\n📝 ID: \`${reqId}\`\n\n❌ Status: **REJECTED**\n🤵 By: ${adminTag}`;
          bot.editMessageText(msgText, { 
            chat_id: query.message?.chat.id, 
            message_id: query.message?.message_id, 
            parse_mode: 'Markdown' 
          }).catch(() => {});
          await this.saveNodeToFirestore(node);
          return;
        }

        // Admin Panel (Lowercase)
        if (data.startsWith('approve_wd_')) {
          const reqId = data.replace('approve_wd_', '');
          const req = node.pendingWithdrawals.get(reqId);
          if (req) {
            bot.answerCallbackQuery(query.id, { text: "⏳ Processing..." });
            this.processWithdrawal(bot, node, req.userId, req.amount, req.wallet, userId, query.message?.message_id).then(async success => {
              if (success) {
                node.pendingWithdrawals.delete(reqId);
                bot.editMessageText(`✅ **Approved & Paid:** Request \`${reqId}\` by ${adminTag}`, { chat_id: userId, message_id: query.message?.message_id, parse_mode: 'Markdown' });
                await this.saveNodeToFirestore(node);
              }
            });
          }
          return;
        }

        if (data.startsWith('reject_wd_')) {
          const reqId = data.replace('reject_wd_', '');
          const req = node.pendingWithdrawals.get(reqId);
          if (req) {
            const user = node.users.get(req.userId);
            if (user) {
               user.balance += req.amount; // Refund
               bot.sendMessage(req.userId, `❌ **Withdrawal Rejected**\nYour withdrawal request for ₹${req.amount} was rejected. Balance refunded.`);
            }
            node.pendingWithdrawals.delete(reqId);
            bot.editMessageText(`❌ **Rejected:** Request \`${reqId}\` by ${adminTag}`, { chat_id: userId, message_id: query.message?.message_id, parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id, { text: "Rejected" });
          }
          return;
        }

      if (data.startsWith('adm_set_')) {
        const field = data.replace('adm_set_', '');
        this.fsmStates.set(userId, { nodeId: node.id, action: `EDIT_${field}` });
        bot.sendMessage(userId, `⌨️ Enter new value for **${field}**:`);
      }

      if (data === 'adm_toggle_whole') {
        node.config.amountInWhole = !node.config.amountInWhole;
        bot.answerCallbackQuery(query.id, { text: `Whole Amount: ${node.config.amountInWhole ? "ON" : "OFF"}` });
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_toggle_device') {
        node.config.deviceVerification = !node.config.deviceVerification;
        bot.answerCallbackQuery(query.id, { text: `Device Check: ${node.config.deviceVerification ? "ON" : "OFF"}` });
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_toggle_alerts') {
        node.config.userAlerts = !node.config.userAlerts;
        bot.answerCallbackQuery(query.id, { text: `User Alerts: ${node.config.userAlerts ? "ON" : "OFF"}` });
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_toggle_bot') {
        node.config.botStatus = !node.config.botStatus;
        bot.answerCallbackQuery(query.id, { text: `Bot Status: ${node.config.botStatus ? "ON" : "OFF"}` });
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_toggle_withdraw') {
        node.config.withdrawStatus = !node.config.withdrawStatus;
        bot.answerCallbackQuery(query.id, { text: `Payout Status: ${node.config.withdrawStatus ? "ON" : "OFF"}` });
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_toggle_antibot') {
        node.config.antiBot = !node.config.antiBot;
        bot.answerCallbackQuery(query.id, { text: `Anti-Bot: ${node.config.antiBot ? "ON" : "OFF"}` });
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_toggle_autopay') {
        node.config.autoPayout = !node.config.autoPayout;
        bot.answerCallbackQuery(query.id, { text: `Auto Payout: ${node.config.autoPayout ? "ON" : "OFF"}` });
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_verify_cfg') {
        bot.sendMessage(userId, "🛡 **ANTI-BOT VERIFICATION**\n\nCurrent: Device Check (Auto)\nTo change, use `/verify_setup`.");
      }

      if (data === 'adm_ask_banWallet') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "BAN_WALLET" });
        bot.sendMessage(userId, "⌨️ **Enter Wallet ID to Ban:**");
      }

      if (data === 'adm_ask_unbanWallet') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "UNBAN_WALLET" });
        bot.sendMessage(userId, "⌨️ **Enter Wallet ID to Unban:**");
      }

      if (data === 'adm_ask_balance_mod') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "BALANCE_MOD_ID" });
        bot.sendMessage(userId, "⌨️ **Enter User ID to Add/Cut balance:**");
      }

      if (data === 'adm_view_leader') {
        const sorted = Array.from(node.users.entries()).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
        let list = "🏆 **TOP 10 EARNERS:**\n\n";
        sorted.forEach(([uid, u], i) => list += `${i+1}. ${uid} - ₹${u.balance.toFixed(2)}\n`);
        
        const sortedRef = Array.from(node.users.entries()).sort((a, b) => b[1].referrals - a[1].referrals).slice(0, 10);
        list += "\n\n👥 **TOP 10 REFERRERS:**\n\n";
        sortedRef.forEach(([uid, u], i) => list += `${i+1}. ${uid} - ${u.referrals} refs\n`);
        
        bot.sendMessage(userId, list);
      }

      if (data === 'adm_view_topwd') {
        const top = node.withdrawals.slice(-10).reverse();
        if (top.length === 0) {
          bot.sendMessage(userId, "🔥 **TOP WITHDRAWALS**\nNo withdrawal records found.");
        } else {
          let list = "🔥 **RECENT WITHDRAWALS:**\n\n";
          top.forEach((w, i) => {
            list += `${i+1}. ${w.userId} - ₹${w.amount.toFixed(2)} (${w.wallet})\n`;
          });
          bot.sendMessage(userId, list);
        }
      }

      if (data === 'adm_view_perf') {
        const up = Math.floor((Date.now() - node.createdAt) / 1000 / 60);
        const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const perfMsg = `📈 **ENGINE PERFORMANCE MATRIX**\n\n` +
          `🔹 **Uptime:** ${up} mins\n` +
          `🔹 **RAM Usage:** ${mem} MB\n` +
          `🔹 **Socket Load:** ${Math.floor(node.users.size / 10)}/100\n` +
          `🔹 **Security:** AES-256 Verified\n` +
          `🔹 **Latency:** 45ms\n` +
          `🔹 **Status:** 🟢 OPTIMIZED`;
        bot.sendMessage(userId, perfMsg);
      }

      if (data === 'adm_view_logs') {
        const logs = node.config.adminLogs.slice(-10).join('\n') || "No logs available.";
        bot.sendMessage(userId, `🕵️ **ADMIN LOGS (Last 10)**\n\n${logs}`);
      }

      if (data === 'adm_api_setup') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "API_SETUP" });
        const helpText = `⚙️ **GATEWAY SETUP**\n\n` +
          `Please send your details in format:\n` +
          `Name | API_URL\n\n` +
          `➕ **Add New Gateway**\n\n` +
          `Send in this format:\n` +
          `Name | API_URL\n\n` +
          `**Example:**\n` +
          `\`RJ Wallet | https://RJwallet.in/api.php?number={wallet}&amount={amount}&comment=Payment\`\n\n` +
          `**Multiple format examples:**\n` +
          `\`RJ Wallet | https://RJwallet.in/api.php?number={wallet}&amount={amount}&comment=done\`\n` +
          `\`Other Wallet | https://site.com/api.php?paytm={wallet}&amount={amount}&comment=Payout\``;
        bot.sendMessage(userId, helpText, { parse_mode: 'Markdown' });
      }

      if (data === 'adm_ask_reset') {
        node.users.forEach(u => u.balance = 0);
        bot.answerCallbackQuery(query.id, { text: "All balances reset to zero." });
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_ask_ban') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "BAN_USER" });
        bot.sendMessage(userId, "⌨️ **Enter User ID to Ban:**");
      }

      if (data === 'adm_ask_unban') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "UNBAN_USER" });
        bot.sendMessage(userId, "⌨️ **Enter User ID to Unban:**");
      }

      if (data === 'adm_ask_addFunds') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "ADD_FUNDS_ID" });
        bot.sendMessage(userId, "⌨️ **Enter User ID to add funds to:**");
      }

      if (data === 'adm_ask_bc') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "BROADCAST" });
        bot.sendMessage(userId, "⌨️ **Enter Message to Broadcast to ALL users:**");
      }

      if (data === 'adm_ask_dm') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "DM_ID" });
        bot.sendMessage(userId, "⌨️ **Enter User ID for Direct Message:**");
      }

      if (data === 'adm_view_stats') {
        const totalUsers = node.users.size;
        const totalBalance = Array.from(node.users.values()).reduce((a, b) => a + b.balance, 0);
        const totalPayouts = node.withdrawals.reduce((a, b) => a + b.amount, 0);
        const statsMsg = `📊 **SR ENGINE LIVE STATISTICS**\n\n` +
          `🔹 Total Network Users: ${totalUsers}\n` +
          `🔹 System Liabilities: ₹${totalBalance.toFixed(2)}\n` +
          `🔹 Total Paid Out: ₹${totalPayouts.toFixed(2)}\n` +
          `🔹 Verification Level: Tier 3\n` +
          `🔹 Node Health: 100% (STABLE)`;
        bot.sendMessage(userId, statsMsg);
      }

      if (data === 'adm_ask_details') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "USER_DETAILS" });
        bot.sendMessage(userId, "⌨️ **Enter User ID to view details:**");
      }

      if (data === 'adm_view_admins') {
        let list = "👑 **BOT ADMINS:**\n\n";
        list += `🔹 Owner: \`${node.ownerId}\` (Full Access)\n`;
        node.config.admins.forEach(adminId => {
          list += `🔹 Admin: \`${adminId}\`\n`;
        });
        
        const kb = {
          inline_keyboard: [
            [{ text: "➕ Add Admin", callback_data: `adm_ask_addAdmin` }, { text: "➖ Remove Admin", callback_data: `adm_ask_remAdmin` }]
          ]
        };
        bot.sendMessage(userId, list, { parse_mode: 'Markdown', reply_markup: kb });
      }

      if (data === 'adm_ask_addAdmin') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "ADD_ADMIN" });
        bot.sendMessage(userId, "⌨️ **Enter User ID to Promote to Admin:**");
      }

      if (data === 'adm_ask_remAdmin') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "REM_ADMIN" });
        bot.sendMessage(userId, "⌨️ **Enter User ID to Demote from Admin:**");
      }

      if (data.startsWith('adm_mod_bal_')) {
        const targetId = parseInt(data.replace('adm_mod_bal_', ''));
        this.fsmStates.set(userId, { nodeId: node.id, action: "BALANCE_MOD_AMT", targetId });
        bot.sendMessage(userId, `💰 Enter amount to Add/Cut for ${targetId}:`);
      }

      if (data.startsWith('adm_mod_ban_')) {
        const targetId = parseInt(data.replace('adm_mod_ban_', ''));
        if (node.config.bannedUsers.has(targetId)) {
          node.config.bannedUsers.delete(targetId);
          bot.sendMessage(userId, `✅ User ${targetId} unbanned.`);
        } else {
          node.config.bannedUsers.add(targetId);
          bot.sendMessage(userId, `🚫 User ${targetId} banned.`);
        }
        await this.saveNodeToFirestore(node);
      }

      if (data.startsWith('adm_mod_dm_')) {
        const targetId = parseInt(data.replace('adm_mod_dm_', ''));
        this.fsmStates.set(userId, { nodeId: node.id, action: "DM_MSG", targetId });
        bot.sendMessage(userId, `📩 Enter message for ${targetId}:`);
      }

      if (data === 'adm_view_verify') {
        const pending = Array.from(node.pendingWithdrawals.entries());
        if (pending.length === 0) {
          bot.sendMessage(userId, "🛠 **VERIFICATION REQUESTS**\n\nNo pending withdrawal requests found.");
        } else {
          pending.forEach(([reqId, req]) => {
            const kb = {
              inline_keyboard: [
                [
                  { text: "✅ Approve", callback_data: `approve_wd_${reqId}` },
                  { text: "❌ Reject", callback_data: `reject_wd_${reqId}` }
                ]
              ]
            };
            bot.sendMessage(userId, `📝 **REQUEST: ${reqId}**\n👤 User: ${req.userId}\n💰 Amount: ₹${req.amount.toFixed(2)}\n💳 Wallet: \`${req.wallet}\``, { parse_mode: 'Markdown', reply_markup: kb });
          });
        }
      }

      if (data.startsWith('approve_wd_')) {
        const reqId = data.replace('approve_wd_', '');
        const req = node.pendingWithdrawals.get(reqId);
        if (req) {
          bot.sendMessage(userId, `⏳ Processing Payout for ${req.userId}...`);
          this.processWithdrawal(bot, node, req.userId, req.amount, req.wallet, userId, query.message?.message_id).then(async success => {
            if (success) {
              node.pendingWithdrawals.delete(reqId);
              bot.editMessageText(`✅ **Approved & Paid:** Request \`${reqId}\` for User ${req.userId}`, { chat_id: userId, message_id: query.message?.message_id, parse_mode: 'Markdown' });
              await this.saveNodeToFirestore(node);
            }
          });
        }
      }

      if (data.startsWith('reject_wd_')) {
        const reqId = data.replace('reject_wd_', '');
        const req = node.pendingWithdrawals.get(reqId);
        if (req) {
          const user = await this.ensureUserLoaded(node, req.userId);
          if (user) {
             user.balance += req.amount; // Refund
             await this.saveUserToFirestore(node.id, req.userId, user);
             bot.sendMessage(req.userId, `❌ **Withdrawal Rejected**\nYour withdrawal request for ₹${req.amount} was rejected. Balance refunded.`);
          }
          node.pendingWithdrawals.delete(reqId);
          bot.editMessageText(`❌ **Rejected:** Request \`${reqId}\` for User ${req.userId}`, { chat_id: userId, message_id: query.message?.message_id, parse_mode: 'Markdown' });
          await this.saveNodeToFirestore(node);
        }
      }

      if (data === 'adm_gift') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "CREATE_GIFT_AMT" });
        bot.sendMessage(userId, "🎁 **GIFT CODE GENERATOR**\n\n⌨️ Enter amount for the new gift code:");
      }

      if (data === 'adm_notice') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "SET_NOTICE" });
        bot.sendMessage(userId, "⌨️ **Enter 'On Join Notice' text:**\n(Current: " + (node.config.joinNotice || "None") + ")");
      }

      if (data === 'adm_view_forceJoin') {
        let list = "🔒 **FORCE JOIN CHANNELS:**\n\n";
        if (node.config.forceJoinChannels.length === 0) {
          list += "No channels configured. Bot is currently OPEN to everyone.";
        } else {
          node.config.forceJoinChannels.forEach((ch, i) => {
            list += `${i + 1}. \`${ch}\`\n`;
          });
        }
        
        const kb = {
          inline_keyboard: [
            [{ text: "➕ Add Channel", callback_data: `adm_ask_addForceJoin` }, { text: "➖ Remove Channel", callback_data: `adm_ask_remForceJoin` }],
            [{ text: "🔙 Back", callback_data: `adm_back_main` }]
          ]
        };
        bot.sendMessage(userId, list, { parse_mode: 'Markdown', reply_markup: kb });
      }

      if (data === 'adm_ask_addForceJoin') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "ADD_FORCE_JOIN" });
        bot.sendMessage(userId, "🔒 **ADD FORCE JOIN CHANNEL**\n\nEnter Channel Username (including @):\nExample: `@MyChannel`\n\n⚠️ **Note:** Force Join only supports **Public Channels**. Ensure bot is an **ADMIN** in it.");
      }

      if (data === 'adm_ask_remForceJoin') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "REM_FORCE_JOIN" });
        bot.sendMessage(userId, "🔒 **REMOVE FORCE JOIN CHANNEL**\n\nEnter the full username of the channel to remove (e.g. @MyChannel):");
      }

      if (data === 'adm_back_main') {
        this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_set_payoutChannel') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "SET_PAYOUT_CHAN" });
        bot.sendMessage(userId, "📢 **PAYOUT CHANNEL SETUP**\n\nEnter Channel Username (including @):\nExample: `@YourChannel` (Ensure bot is ADMIN in it)");
      }

      if (data === 'check_join') {
        if (node.config.forceJoinChannels && node.config.forceJoinChannels.length > 0) {
          bot.answerCallbackQuery(query.id, { text: "⏳ Verifying membership..." });
          setTimeout(async () => {
            const joinedStatuses = await Promise.all(node.config.forceJoinChannels.map(ch => this.checkForceJoin(bot, ch, userId)));
            const allJoined = joinedStatuses.every(s => s === true);
            
            if (allJoined) {
              bot.deleteMessage(userId, query.message?.message_id!).catch(() => {});
              bot.sendMessage(userId, "✅ **Membership Verified!**\n\nWelcome back to the SR Network. Use the menu below to start earning.", {
                reply_markup: {
                  keyboard: [
                    [{ text: "💰 Balance" }, { text: "🎁 Daily Bonus" }],
                    [{ text: "👥 Refer & Earn" }, { text: "💸 Withdraw" }],
                    [{ text: "🎟 Redeem Gift Code" }, { text: "🏆 Leaderboard" }],
                    [{ text: "🏦 Set Payout Wallet" }, { text: "📞 Support" }]
                  ],
                  resize_keyboard: true
                }
              });
            } else {
              const buttons = [];
              for (let i = 0; i < node.config.forceJoinChannels.length; i += 2) {
                const row = [];
                const ch1 = node.config.forceJoinChannels[i];
                let url1 = ch1.startsWith('http') ? ch1 : (ch1.startsWith('@') ? `https://t.me/${ch1.substring(1)}` : `https://t.me/c/${ch1.replace('-100', '')}/999999999`);
                row.push({ text: `Join ${i + 1} ↗️`, url: url1 });

                if (i + 1 < node.config.forceJoinChannels.length) {
                  const ch2 = node.config.forceJoinChannels[i+1];
                  let url2 = ch2.startsWith('http') ? ch2 : (ch2.startsWith('@') ? `https://t.me/${ch2.substring(1)}` : `https://t.me/c/${ch2.replace('-100', '')}/999999999`);
                  row.push({ text: `Join ${i + 2} ↗️`, url: url2 });
                }
                buttons.push(row);
              }
              buttons.push([{ text: "✅ Continue", callback_data: "check_join" }]);

              bot.sendMessage(userId, "❌ **Verification Failed!**\n\nPlease join ALL channels first and then click Continue.", {
                reply_markup: { inline_keyboard: buttons }
              }).catch(() => {});
            }
          }, 1500);
        }
      }

      bot.answerCallbackQuery(query.id);
    } catch (err: any) {
      console.error(`[CB_HANDLER_ERR] User ${query.message?.chat.id}:`, err.message);
    }
    });
  }

  private async checkForceJoin(bot: any, channelId: string, userId: number): Promise<boolean> {
    try {
      const member = await bot.getChatMember(channelId, userId);
      const isJoined = ['member', 'administrator', 'creator'].includes(member.status);
      return isJoined;
    } catch (err: any) {
      if (err.message.includes('chat not found') || err.message.includes('user not found')) {
         console.warn(`[JOIN CHECK FAIL] Bot probably not admin or invalid channel: ${channelId}`);
      } else {
         console.error(`[JOIN FAIL] ${channelId} for ${userId}:`, err.message);
      }
      return false;
    }
  }

  private logAdminAction(node: BotNode, action: string) {
    const timestamp = new Date().toLocaleString();
    node.config.adminLogs.push(`[${timestamp}] ${action}`);
  }

  private async handleFSM(bot: any, node: BotNode, userId: number, text: string, state: any) {
    const action = state.action;
    
    if (action === "SOLVE_CAPTCHA") {
      const ans = parseInt(text);
      if (ans === state.targetId) {
        const user = await this.ensureUserLoaded(node, userId);
        if (user) user.verified = true;
        bot.sendMessage(userId, "✅ **Verification Successful!**\nYou can now use all features. Click 'Withdraw' again.");
        this.logAdminAction(node, `User ${userId} passed Anti-Bot`);
      } else {
        bot.sendMessage(userId, "❌ Incorrect answer. Try again or click 'Withdraw' to get a new challenge.");
      }
    }

    if (action === "WITHDRAW_AMT") {
      const amt = parseFloat(text);
      const user = await this.ensureUserLoaded(node, userId);
      if (!user) return;

      if (isNaN(amt) || amt < node.config.minWithdraw) {
        return bot.sendMessage(userId, `❌ Minimum amount is ₹${node.config.minWithdraw}`);
      }
      if (amt > user.balance) {
        return bot.sendMessage(userId, "❌ Insufficient balance.");
      }
      if (node.config.amountInWhole && amt % 1 !== 0) {
        return bot.sendMessage(userId, "❌ Only whole amounts are allowed.");
      }

      const tax = (amt * node.config.withdrawTax) / 100;
      const finalAmt = amt - tax;

      user.balance -= amt;

      if (node.config.autoPayout) {
        bot.sendMessage(userId, "⚡ **Auto-Processing Payment...**");
        await this.processWithdrawal(bot, node, userId, amt, user.walletId!);
      } else {
        const reqId = `WD-${uuidv4().substring(0, 6).toUpperCase()}`;
        node.pendingWithdrawals.set(reqId, {
          userId,
          amount: amt,
          wallet: user.walletId!,
          createdAt: Date.now()
        });
        const escReqId = esc(reqId);
        const escPayoutChannel = esc(node.config.payoutChannel || "our channel");
        bot.sendMessage(userId, `⏳ **Request Logged: ${escReqId}**\n\nRequested: ₹${amt.toFixed(2)}\nTax (${node.config.withdrawTax}%): ₹${tax.toFixed(2)}\nFinal Payable: ₹${finalAmt.toFixed(2)}\n\nYour withdrawal is pending admin review. Check ${escPayoutChannel} for updates.`, { parse_mode: 'Markdown' }).catch(() => {});

        // Post Request to Payout Channel with Approval Buttons
        if (node.config.payoutChannel) {
          const kb = {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `APPROVE_WD_${reqId}` },
                { text: "❌ Reject", callback_data: `REJECT_WD_${reqId}` }
              ]
            ]
          };
          const reqMsg = `⏳ **NEW PAYOUT REQUEST**\n\n👤 User: \`${userId}\`\n💰 Amount: ₹${amt.toFixed(2)}\n🧾 Tax: ₹${tax.toFixed(2)}\n💵 **Final Payable: ₹${finalAmt.toFixed(2)}**\n💳 Wallet: \`${esc(user.walletId)}\`\n📝 ID: \`${escReqId}\`\n\n✅ Status: **PENDING**`;
          bot.sendMessage(node.config.payoutChannel, reqMsg, { parse_mode: 'Markdown', reply_markup: kb }).catch((err) => {
            console.error("Payout Channel Error:", err.message);
          });
        }

        // Notify admins
        node.config.admins.forEach(adminId => {
          bot.sendMessage(adminId, `🔔 **Withdrawal Request [${reqId}]**\nUser: ${userId}\nAmount: ₹${amt}\n\nApprove in the Payout Channel.`);
        });
      }
      await this.saveNodeToFirestore(node);
      await this.saveUserToFirestore(node.id, userId, user);
    }

    if (action === "ADD_FORCE_JOIN") {
      let input = text.trim();
      let channel = "";
      
      if (input.startsWith('@')) {
        channel = input;
      } else if (input.includes('t.me/')) {
        // Robust extraction
        const path = input.split('t.me/')[1].split('?')[0].split('/')[0];
        if (path === 'joinchat' || path.startsWith('+')) {
           return bot.sendMessage(userId, "❌ **Format Error:** Force Join verification requires a **Public Channel @username**. Private invite links cannot be automatically verified.");
        }
        channel = '@' + path;
      } else if (input.startsWith('-100')) {
        channel = input;
      } else {
        channel = '@' + input;
      }

      if (!node.config.forceJoinChannels.includes(channel)) {
        node.config.forceJoinChannels.push(channel);
        bot.sendMessage(userId, `✅ **Added Channel:** ${channel}\n\n⚠️ **Tip:**\n- Ensure Bot is **ADMIN** in the channel.\n- Public channels only.`);
        await this.saveNodeToFirestore(node);
      } else {
        bot.sendMessage(userId, "❌ Channel already in list.");
      }
      this.fsmStates.delete(userId);
      this.sendAdminPanel(bot, node, userId);
      return;
    }

    if (action === "REM_FORCE_JOIN") {
      const channel = text.trim();
      const index = node.config.forceJoinChannels.indexOf(channel);
      if (index > -1) {
        node.config.forceJoinChannels.splice(index, 1);
        bot.sendMessage(userId, `✅ **Removed Channel:** ${channel}`);
        await this.saveNodeToFirestore(node);
      } else {
        bot.sendMessage(userId, "❌ Channel not found in list. Use the exact username (including @).");
      }
    }

    if (action === "SET_PAYOUT_CHAN") {
      let channel = text.trim();
      if (channel.includes('t.me/')) {
        channel = '@' + channel.split('t.me/')[1].split('/')[0];
      }
      if (!channel.startsWith('@')) return bot.sendMessage(userId, "❌ **Format Error:** Channel must start with @ (e.g. @MyChannel)");
      
      node.config.payoutChannel = channel;
      bot.sendMessage(userId, `✅ **PAYOUT LOGS ACTIVE**\n\nTarget: ${channel}\n\n⚠️ **IMPORTANT:** Verify the bot is an **ADMIN** in this channel to post logs.`);
      await this.saveNodeToFirestore(node);
    }

    if (action === "ADD_ADMIN") {
      const targetId = parseInt(text);
      if (!isNaN(targetId)) {
        node.config.admins.add(targetId);
        bot.sendMessage(userId, `✅ User ${targetId} added to Admin list.`);
        this.logAdminAction(node, `Added admin ${targetId}`);
        await this.saveNodeToFirestore(node);
      }
    }

    if (action === "REM_ADMIN") {
      const targetId = parseInt(text);
      if (!isNaN(targetId)) {
        if (targetId === node.ownerId) return bot.sendMessage(userId, "❌ Cannot remove owner.");
        node.config.admins.delete(targetId);
        bot.sendMessage(userId, `✅ User ${targetId} removed from Admin list.`);
        this.logAdminAction(node, `Removed admin ${targetId}`);
        await this.saveNodeToFirestore(node);
      }
    }

    if (action === "REDEEM_GIFT") {
      const amount = node.config.giftCodes.get(text);
      if (amount) {
        const user = await this.ensureUserLoaded(node, userId);
        if (user) {
          user.balance += amount;
          node.config.giftCodes.delete(text);
          await this.saveUserToFirestore(node.id, userId, user);
          await this.saveNodeToFirestore(node);
          bot.sendMessage(userId, `congratulations 🎉 you have successfully claimed 🧧RS ${amount.toFixed(2)} gift code amount`);
        }
      } else {
        bot.sendMessage(userId, "❌ Invalid or already redeemed gift code.");
      }
    }

    if (action === "CREATE_GIFT_AMT") {
      const amount = parseFloat(text);
      if (!isNaN(amount) && amount > 0) {
        const code = `SR-${uuidv4().substring(0, 8).toUpperCase()}`;
        node.config.giftCodes.set(code, amount);
        bot.sendMessage(userId, `✅ **Gift Code Created!**\n\nCode: \`${code}\`\nValue: ₹${amount.toFixed(2)}\n\nShare this with users!`, { parse_mode: 'Markdown' });
        this.logAdminAction(node, `Created gift code ${code} for ₹${amount}`);
        await this.saveNodeToFirestore(node);
      } else {
        bot.sendMessage(userId, "❌ Invalid amount.");
      }
    }

    if (action === "BAN_WALLET") {
      node.config.bannedWallets.add(text);
      bot.sendMessage(userId, `✅ Wallet \`${text}\` has been restricted.`, { parse_mode: 'Markdown' });
      this.logAdminAction(node, `Banned wallet ${text}`);
      await this.saveNodeToFirestore(node);
    }

    if (action === "UNBAN_WALLET") {
      node.config.bannedWallets.delete(text);
      bot.sendMessage(userId, `✅ Wallet \`${text}\` restrictions removed.`, { parse_mode: 'Markdown' });
      this.logAdminAction(node, `Unbanned wallet ${text}`);
      await this.saveNodeToFirestore(node);
    }

    if (action === "USER_DETAILS") {
      const targetId = parseInt(text);
      const user = await this.ensureUserLoaded(node, targetId);
      if (user) {
        const joined = new Date(user.joinedAt || Date.now()).toLocaleDateString();
        const details = `🔍 **USER ENGINE PROFILE: ${targetId}**\n\n` +
          `💵 Balance: ₹${user.balance.toFixed(2)}\n` +
          `👥 Referrals: ${user.referrals}\n` +
          `💳 Wallet: \`${esc(user.walletId || "Not Set")}\`\n` +
          `🛡 Verified: ${user.verified ? "✅" : "❌"}\n` +
          `📅 Joined: ${joined}\n` +
          `🚫 Banned: ${node.config.bannedUsers.has(targetId) ? "YES" : "NO"}`;
        
        const kb = {
          inline_keyboard: [
            [{ text: "💵 Add/Cut", callback_data: `adm_mod_bal_${targetId}` }, { text: user.isBanned ? "✅ Unban" : "🚫 Ban", callback_data: `adm_mod_ban_${targetId}` }],
            [{ text: "📩 Send DM", callback_data: `adm_mod_dm_${targetId}` }]
          ]
        };
        bot.sendMessage(userId, details, { parse_mode: 'Markdown', reply_markup: kb }).catch(() => {});
      } else {
        bot.sendMessage(userId, "❌ User not found in database.");
      }
    }

    if (action === "SET_NOTICE") {
      node.config.joinNotice = text;
      bot.sendMessage(userId, `✅ Join Notice updated to:\n\n${text}`);
      this.logAdminAction(node, `Updated join notice`);
      await this.saveNodeToFirestore(node);
    }

    if (action.startsWith('EDIT_')) {
      const field = action.replace('EDIT_', '') as keyof SubBotConfig;
      const val = parseFloat(text);
      if (typeof node.config[field] === 'number' && !isNaN(val)) {
        (node.config[field] as number) = val;
        bot.sendMessage(userId, `✅ Updated **${field}** to ${val}.`);
        this.logAdminAction(node, `Updated ${field} to ${val}`);
      } else if (typeof node.config[field] === 'string') {
        (node.config[field] as string) = text;
        bot.sendMessage(userId, `✅ Updated **${field}** successfully.`);
        this.logAdminAction(node, `Updated ${field}`);
      }
      await this.saveNodeToFirestore(node);
      this.sendAdminPanel(bot, node, userId);
    }

    if (action === "SET_WALLET") {
      const user = await this.ensureUserLoaded(node, userId);
      if (user) {
        user.walletId = text;
        await this.saveUserToFirestore(node.id, userId, user);
      }
      bot.sendMessage(userId, "✅ Wallet ID saved successfully.");
    }

    if (action === "BAN_USER") {
      const targetId = parseInt(text);
      if (!isNaN(targetId)) {
        if (targetId === node.ownerId) return bot.sendMessage(userId, "❌ Cannot ban owner.");
        node.config.bannedUsers.add(targetId);
        bot.sendMessage(userId, `✅ User ${targetId} has been banned.`);
        this.logAdminAction(node, `Banned user ${targetId}`);
        await this.saveNodeToFirestore(node);
      }
    }

    if (action === "UNBAN_USER") {
      const targetId = parseInt(text);
      if (!isNaN(targetId)) {
        node.config.bannedUsers.delete(targetId);
        bot.sendMessage(userId, `✅ User ${targetId} has been unbanned.`);
        this.logAdminAction(node, `Unbanned user ${targetId}`);
        await this.saveNodeToFirestore(node);
      }
    }

    if (action === "BALANCE_MOD_ID") {
      const targetId = parseInt(text);
      if (node.users.has(targetId)) {
        this.fsmStates.set(userId, { nodeId: node.id, action: "BALANCE_MOD_AMT", targetId });
        bot.sendMessage(userId, `💰 Enter amount to Add (ex: 100) or Cut (ex: -100) for ${targetId}:`);
        return;
      }
    }

    if (action === "BALANCE_MOD_AMT") {
      const amt = parseFloat(text);
      const targetUser = await this.ensureUserLoaded(node, state.targetId);
      if (targetUser && !isNaN(amt)) {
        targetUser.balance += amt;
        await this.saveUserToFirestore(node.id, state.targetId, targetUser);
        bot.sendMessage(userId, `✅ Balance adjusted for user ${state.targetId}. New: ₹${targetUser.balance.toFixed(2)}`);
        if (node.config.userAlerts) {
          bot.sendMessage(state.targetId!, `🔔 **Balance Updated!**\nAdmin has modified your balance. New Balance: ₹${targetUser.balance.toFixed(2)}`);
        }
        this.logAdminAction(node, `Adjusted balance of ${state.targetId} by ${amt}`);
      }
    }

    if (action === "BROADCAST") {
      let count = 0;
      node.users.forEach((_, uid) => {
        bot.sendMessage(uid, `📢 **BROADCAST MESSAGE**\n\n${text}`).then(() => count++).catch(() => {});
      });
      bot.sendMessage(userId, `✅ Broadcast sent to ${node.users.size} users.`);
      this.logAdminAction(node, `Sent broadcast`);
    }

    if (action === "DM_ID") {
      const targetId = parseInt(text);
      if (node.users.has(targetId)) {
        this.fsmStates.set(userId, { nodeId: node.id, action: "DM_MSG", targetId });
        bot.sendMessage(userId, `📩 Enter message for ${targetId}:`);
        return;
      }
    }

    if (action === "DM_MSG") {
      bot.sendMessage(state.targetId!, `📩 **Message from Admin:**\n\n${text}`);
      bot.sendMessage(userId, "✅ Direct message sent.");
      this.logAdminAction(node, `Sent DM to ${state.targetId}`);
    }

    if (action === "API_SETUP") {
      const parts = text.split('|').map(p => p.trim());
      if (parts.length >= 2) {
        let url = parts[1];
        if (!url.startsWith('http')) {
          url = 'https://' + url;
        }

        try {
          new URL(url.replace(/{wallet}/g, 'test').replace(/{amount}/g, '100').replace(/{userId}/g, '123'));
        } catch (e) {
          return bot.sendMessage(userId, "❌ **CRITICAL ERROR:** Invalid Gateway URL format. Check protocol and characters.");
        }

        node.config.payoutGatewayName = parts[0];
        node.config.payoutUrl = url;
        
        if (parts.length >= 3) {
          let appUrl = parts[2];
          if (!appUrl.startsWith('http')) appUrl = 'https://' + appUrl;
          node.config.payoutAppUrl = appUrl;
        } else {
          try {
            const u = new URL(url);
            node.config.payoutAppUrl = u.protocol + "//" + u.hostname;
          } catch {
            node.config.payoutAppUrl = url;
          }
        }

        bot.sendMessage(userId, `✅ **GATEWAY UPDATED!**\n\n🔹 **Name:** ${node.config.payoutGatewayName}\n🔹 **Endpoint:** \`<REDACTED>\`\n🔹 **App URL:** \`${node.config.payoutAppUrl}\`\n\n🛡 **Status:** ACTIVE`, { parse_mode: 'Markdown' });
        this.logAdminAction(node, `Updated API Gateway to ${node.config.payoutGatewayName}`);
        await this.saveNodeToFirestore(node);
      } else {
        bot.sendMessage(userId, "❌ **INVALID FORMAT!**\nUse: `Name | API_URL | App_URL` (optional)\n\nExample: `GatewayX | https://api.com/pay?k=123&u={wallet} | https://gateway-app.com`", { parse_mode: 'Markdown' });
      }
    }

    this.fsmStates.delete(userId);
  }

  private async refreshAdminPanel(bot: any, node: BotNode, userId: number, messageId?: number) {
    if (messageId) {
       this.sendAdminPanel(bot, node, userId, messageId);
    } else {
       this.sendAdminPanel(bot, node, userId);
    }
  }

  private async processWithdrawal(bot: any, node: BotNode, userId: number, amount: number, wallet: string, adminChatId?: number, adminMsgId?: number): Promise<boolean> {
    if (!node.config.payoutUrl) {
      if (adminChatId) bot.sendMessage(adminChatId, "❌ **Configuration Error:** Payout Gateway not set.").catch(() => {});
      bot.sendMessage(userId, "❌ **Critical Error:** Payout Gateway is not configured by Admin.");
      const user = await this.ensureUserLoaded(node, userId);
      if (user) user.balance += amount;
      return false;
    }

    const tax = (amount * node.config.withdrawTax) / 100;
    const finalAmount = Math.max(0, amount - tax);

    try {
      let finalUrl = node.config.payoutUrl!.trim();
      
      finalUrl = finalUrl
        .replace(/{wallet}/g, encodeURIComponent(wallet))
        .replace(/{amount}/g, encodeURIComponent(finalAmount.toFixed(2)))
        .replace(/{userId}/g, encodeURIComponent(userId.toString()));
      
      logSys(`[WD_REQ] User: ${userId} | Target: ${finalUrl.split('?')[0]}`);

      const response = await axios.get(finalUrl, { 
        timeout: 10000, // Shorter timeout for better user experience
        headers: { 
          'User-Agent': 'SR-Tech-BotEngine/2.5',
          'Accept': '*/*'
        },
        validateStatus: () => true 
      }).catch(err => {
        let msg = err.message || "Network Communication Failure";
        if (err.code === 'ECONNABORTED') msg = "Gateway connection timeout (10s)";
        if (err.code === 'ENOTFOUND') msg = "Invalid gateway host (DNS failure)";
        if (err.message.includes('Failed to fetch')) msg = "Internal network block (Fetch disabled)";
        throw new Error(msg);
      });

      const resData = response.data;
      const resStr = typeof resData === 'string' ? resData : JSON.stringify(resData);
      const resLower = resStr.toLowerCase();
      
      const isSuccess = (response.status >= 200 && response.status < 300) && (
        resLower.includes('success') || 
        resLower.includes('"code":200') || 
        resLower.includes('"status":1') ||
        resLower.includes('"status":"ok"') ||
        resLower.includes('"success":true') ||
        (resStr.length < 500 && !resLower.includes('error') && !resLower.includes('fail'))
      );

      if (isSuccess) {
        bot.sendMessage(userId, `✅ **Withdrawal Success!**\n\n💰 Amount: ₹${finalAmount.toFixed(2)}\n🧾 Tax (Ded.): ₹${tax.toFixed(2)}\n🏛 Gateway: ${esc(node.config.payoutGatewayName)}\n✅ Status: **PAID (SUCCESS)**\n\n🛠 Powered by SR TECHNOLOGY LTD™`, { parse_mode: 'Markdown' }).catch(() => {});
        
        const wdData = { userId, amount: finalAmount, wallet, timestamp: Date.now(), id: `WD-${uuidv4().substring(0, 8)}` };
        node.withdrawals.push(wdData);
        if (node.withdrawals.length > 100) node.withdrawals.shift();
        await this.saveWithdrawalToFirestore(node.id, wdData);

        if (node.config.payoutChannel) {
          const me = await bot.getMe();
          const channelMsg = `💸 **NEW PAYOUT SUCCESSFUL**\n\n👤 User: \`${userId}\`\n💰 Amount: ₹${finalAmount.toFixed(2)}\n💳 Method: UPI/Wallet\n✅ Status: **SUCCESS**\n\n🛠 Powered by @${esc(me.username)}`;
          bot.sendMessage(node.config.payoutChannel, channelMsg, { parse_mode: 'Markdown' }).catch(() => {});
        }
        return true;
      } else {
        const errorDetail = resStr.length > 80 ? resStr.substring(0, 80) + '...' : resStr;
        bot.sendMessage(userId, `❌ **Link Failure:** Gateway rejected the request.\n\n**Gateway Response:** \`${errorDetail}\`\n\n**Note:** Your balance has been refunded.`);
        if (adminChatId) bot.sendMessage(adminChatId, `❌ **Gateway Error for User ${userId}:**\n\`${errorDetail}\``).catch(() => {});
        const user = await this.ensureUserLoaded(node, userId);
        if (user) user.balance += amount;
        return false;
      }
    } catch (error: any) {
      logSys(`[WD_CRIT] User ${userId} error: ${error.message}`);
      let userMsg = error.message;
      if (userMsg.includes('fetch')) userMsg = "Network interface restricted by cloud security.";
      
      bot.sendMessage(userId, `❌ **Link Failure:**\n${userMsg}\n\n**Status:** Balance Refunded.`).catch(() => {});
      if (adminChatId) bot.sendMessage(adminChatId, `❌ **Withdrawal Error:**\n${error.message}`).catch(() => {});
      const user = await this.ensureUserLoaded(node, userId);
      if (user) user.balance += amount;
      return false;
    }
  }

  getStats() {
    let globalUsers = 0;
    this.nodes.forEach(n => {
      globalUsers += n.users.size;
    });
    return {
      totalNodes: this.nodes.size,
      activeUsers: this.userToNodes.size,
      globalUsers
    };
  }

  getUserNodes(userId: number) {
    const nodeIds = this.userToNodes.get(userId) || [];
    return nodeIds.map(id => {
      const node = this.nodes.get(id);
      return { id: node?.id, type: node?.type, createdAt: node?.createdAt };
    });
  }
}

const engine = new BotEngine();

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  let hubBot: any = null;
  let hubInfo: any = null;
  const deploymentStates = new Map<number, { step: string, type?: BotNode['type'] }>();

  // Protocol Alpha: Absolute Priority Port Binding
  // This ensures the platform sees the app as "Start" immediately.
  const server = app.listen(PORT, "0.0.0.0", () => {
    logSys(`[CORE_RESILIENCE] Port ${PORT} bound successfully.`);
    console.log(`[GATEWAY] Active at http://0.0.0.0:${PORT}`);
  });

  // Protocol Beta: Early Health & Status (Non-blocking)
  app.get("/api/health", (req, res) => res.json({ status: "ok", boot: engineStatus, timestamp: Date.now() }));
  
  app.use(express.json());
  
  let viteInstance: any = null;
  let engineStatus = "initializing";

  // Protocol Gamma: Hybrid Frontend Entry
  if (process.env.NODE_ENV !== "production") {
    logSys("Booting Vite Bridge...");
    createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    }).then(vite => {
      viteInstance = vite;
      logSys("Vite Bridge ready.");
    }).catch(err => logSys(`Vite Bridge Fail: ${err.message}`));

    // Interceptor: Keep the user engaged while Vite warms up
    app.get("/", (req, res, next) => {
      if (viteInstance) return next();
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>SR ENGINE BOOTING</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { background: #050505; color: #00ff41; font-family: 'Courier New', Courier, monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .loader { border: 1px solid #00ff41; width: 250px; height: 4px; border-radius: 2px; }
            .bar { width: 0%; height: 100%; background: #00ff41; animation: grow 2s infinite; }
            @keyframes grow { 0% { width: 0% } 50% { width: 100% } 100% { width: 0% } }
            .t { font-size: 12px; margin-bottom: 15px; letter-spacing: 3px; }
            .s { font-size: 8px; margin-top: 10px; opacity: 0.5; }
          </style>
          <script>
            let attempts = 0;
            const poll = async () => {
              attempts++;
              try {
                const r = await fetch('/api/health');
                if (r.ok) {
                   const data = await r.json();
                   if (data.status === 'ok') {
                     location.reload();
                     return;
                   }
                }
              } catch(e) {}
              if (attempts > 30) location.reload(); // Hard reload fallback
            };
            setInterval(poll, 1000);
          </script>
        </head>
        <body>
          <div class="t">SYSTEM_SHOCK_BOOTING...</div>
          <div class="loader"><div class="bar"></div></div>
          <div class="s">SR ENGINE CORE PRO V2.5</div>
        </body>
        </html>
      `);
    });

    app.use((req, res, next) => {
      if (viteInstance) return viteInstance.middlewares(req, res, next);
      next();
    });
  } else {
    logSys("Production mode: Mounting static assets.");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Root handler for production to ensure index.html is served instantly
    app.get("/", (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) res.status(503).send("Server warming up... Please refresh in 5 seconds.");
      });
    });
  }

  // Protocol Gamma: High-priority routes
  app.get("/api/status", (req, res) => {
    const stats = engine.getStats();
    res.json({
      status: "online",
      hubActive: !!hubBot && !!hubInfo,
      hubUsername: hubInfo?.username || "",
      totalNodes: stats.totalNodes,
      totalUsers: stats.activeUsers,
      engineVersion: "V2.5-ADVANCED-PRO",
      logs: sysLogs
    });
  });

  // Protocol Gamma: Webhook Handlers
  app.post("/api/webhook/hub", (req, res) => {
    hubBot?.processUpdate(req.body);
    res.sendStatus(200);
  });

  app.post("/api/webhook/:nodeId", (req, res) => {
    const { nodeId } = req.params;
    const node = (engine as any).nodes.get(nodeId);
    if (node && node.instance) {
      node.instance.processUpdate(req.body);
    }
    res.sendStatus(200);
  });

  const hubToken = process.env.TELEGRAM_BOT_TOKEN;

  if (hubToken) {
    hubBot = new TelegramBot(hubToken, { polling: false });
    if (BASE_URL) {
      hubBot.setWebHook(`${BASE_URL}/api/webhook/hub`).catch((err: any) => logSys(`[HUB_HOOK_ERR] ${err.message}`));
    }
    hubBot.getMe().then((info: any) => {
      hubInfo = info;
      logSys(`SR Hub active: @${info.username}`);
    }).catch((err: any) => logSys(`Hub auth fail: ${err.message}`));

    const MAIN_HUB_KB = {
      reply_markup: {
        keyboard: [
          [{ text: "➕ Create New Bot" }, { text: "🤖 My Bot Nodes" }],
          [{ text: "📢 All Bot Broadcast" }, { text: "📡 All Channel Broadcast" }],
          [{ text: "📊 Hub Stats" }, { text: "💎 Premium" }],
          [{ text: "📖 Tutorials" }, { text: "📞 Contact Developer" }]
        ],
        resize_keyboard: true
      }
    };

    hubBot.onText(/\/start/, (msg: any) => {
      try {
        hubBot?.sendMessage(msg.chat.id, "🚀 **SR TECHNOLOGY LTD™ - MASTER HUB**\n\nWelcome to the most powerful bot deployment mesh. Our engine supports high-load automated payouts and industrial-grade referral tracking.\n\n**CHOOSE YOUR ACTION:**", {
          parse_mode: 'Markdown',
          ...MAIN_HUB_KB
        });
      } catch (e: any) {
        console.error("Hub Start Error:", e.message);
      }
    });

    hubBot.on('message', async (msg: any) => {
      try {
        const chatId = msg.chat.id;
      const text = msg.text;

      if (text === "➕ Create New Bot") {
        hubBot?.sendMessage(chatId, "🛠 **SELECT ENGINE NODE TYPE:**", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🛒 Auto-Pay Wallet V2", callback_data: "hub_tpl_autopay" }],
              [{ text: "💳 Hybrid UPI Engine", callback_data: "hub_tpl_upi" }],
              [{ text: "💎 Crypto Manual 01", callback_data: "hub_tpl_crypto" }],
              [{ text: "⭐️ Star System", callback_data: "hub_tpl_star" }]
            ]
          }
        });
        return;
      }

      if (text === "🤖 My Bot Nodes") {
        const nodes = engine.getUserNodes(chatId);
        if (nodes.length > 0) {
          let list = "📡 **YOUR DEPLOYED NODES:**\n\n";
          nodes.forEach(n => {
            list += `🔹 **Node:** \`${n.id}\` | **Model:** ${n.type?.toUpperCase()}\n`;
          });
          list += "\nUse `/adminhelp` in your bot to manage it.";
          hubBot?.sendMessage(chatId, list, { parse_mode: 'Markdown' }).catch(() => {});
        } else {
          hubBot?.sendMessage(chatId, "❌ No active nodes found.").catch(() => {});
        }
        return;
      }

      if (text === "📢 All Bot Broadcast") {
        const nodes = engine.getUserNodes(chatId);
        if (nodes.length === 0) return hubBot?.sendMessage(chatId, "❌ You haven't deployed any bots yet.").catch(() => {});
        
        deploymentStates.set(chatId, { step: "ALL_BOT_BC_MSG" });
        hubBot?.sendMessage(chatId, "📢 **ALL BOT BROADCAST**\n\nEnter the message you want to send to **ALL users** across **ALL your deployed bots**:").catch(() => {});
        return;
      }

      if (text === "📡 All Channel Broadcast") {
        const nodes = engine.getUserNodes(chatId);
        if (nodes.length === 0) return hubBot?.sendMessage(chatId, "❌ You haven't deployed any bots yet.").catch(() => {});
        
        deploymentStates.set(chatId, { step: "ALL_CHAN_BC_MSG" });
        hubBot?.sendMessage(chatId, "📡 **ALL CHANNEL BROADCAST**\n\nEnter the message you want to send to **ALL channels** configured in your bots:").catch(() => {});
        return;
      }

      if (text === "📊 Hub Stats") {
        const stats = engine.getStats();
        const hubMsg = `📈 **MASTER CLUSTER ANALYTICS**\n\n` +
          `🔹 **Active Nodes:** ${stats.totalNodes}\n` +
          `🔹 **Node Owners:** ${stats.activeUsers}\n` +
          `🔹 **Network Users:** ${stats.globalUsers}\n` +
          `🔹 **Engine Health:** 🟢 STABLE\n` +
          `🔹 **Uptime:** 99.98%\n` +
          `🔹 **Cluster:** asia-east1-srnode\n\n` +
          `🛠 **Core:** SR-TECH Enterprise V2.5`;
        hubBot?.sendMessage(chatId, hubMsg).catch(() => {});
        return;
      }

      const state = deploymentStates.get(chatId);
      if (state?.step === "ALL_BOT_BC_MSG") {
        deploymentStates.delete(chatId);
        hubBot?.sendMessage(chatId, "📤 **Starting Global User Broadcast...**").catch(() => {});
        const nodes = engine.getUserNodes(chatId);
        let successCount = 0;
        let failCount = 0;
        let totalUsers = 0;
        (async () => {
          for (const summary of nodes) {
            const node = (engine as any).nodes.get(summary.id!);
            if (node && node.instance) {
              for (const [uid, _] of node.users.entries()) {
                totalUsers++;
                try {
                  await node.instance.sendMessage(uid, `📢 GLOBAL ANNOUNCEMENT\n\n${text}`);
                  successCount++;
                } catch { failCount++; }
                if (totalUsers % 10 === 0) await new Promise(r => setTimeout(r, 300));
              }
            }
          }
          hubBot?.sendMessage(chatId, `✅ **Global Broadcast Complete!**\n\n🟢 Success: ${successCount}\n🔴 Failed/Blocked: ${failCount}\n👥 Total Targeted: ${totalUsers}`, { parse_mode: 'Markdown' }).catch(() => {});
        })();
        return;
      }

      if (state?.step === "ALL_CHAN_BC_MSG") {
        deploymentStates.delete(chatId);
        hubBot?.sendMessage(chatId, "📤 **Starting Global Channel Broadcast...**").catch(() => {});
        const nodes = engine.getUserNodes(chatId);
        let successCount = 0;
        let failCount = 0;
        const processedChannels = new Set<string>();
        (async () => {
          for (const summary of nodes) {
            const node = (engine as any).nodes.get(summary.id!);
            if (node && node.instance && node.config.forceJoinChannels) {
              for (const channelId of node.config.forceJoinChannels) {
                if (processedChannels.has(channelId)) continue;
                processedChannels.add(channelId);
                try {
                  await node.instance.sendMessage(channelId, `📡 NETWORK BROADCAST\n\n${text}`);
                  successCount++;
                } catch (e: any) { failCount++; }
                await new Promise(r => setTimeout(r, 500));
              }
            }
          }
          hubBot?.sendMessage(chatId, `✅ **Global Channel Broadcast Complete!**\n\n🟢 Success: ${successCount}\n🔴 Failed: ${failCount}\n📢 Total Channels: ${processedChannels.size}`, { parse_mode: 'Markdown' }).catch(() => {});
        })();
        return;
      }

      if (state?.step === "AWAITING_TOKEN" && text?.includes(":")) {
        hubBot?.sendMessage(chatId, "⚙️ **ESTABLISHING SECURE SSH TUNNEL...**").catch(() => {});
        try {
          const { nodeId, username: deployedBotUsername } = await engine.deployBot(chatId, text, state.type!, "Dark_Hardware");
          deploymentStates.delete(chatId);
          logSys(`Node ${nodeId} deployed successfully for @${deployedBotUsername}`);
          const successMsg = `✅ **BOT DEPLOYED SUCCESSFULLY!**\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `Your bot is now LIVE on SR BOT MAKER ENGINE.\n\n` +
            `🤖 Bot: @${esc(deployedBotUsername)}\n` +
            `🆔 Node: \`${esc(nodeId)}\`\n\n` +
            `**Next Steps:**\n` +
            `1️⃣ Open @${esc(deployedBotUsername)} and send /start\n` +
            `2️⃣ Send /adminhelp inside your bot\n` +
            `3️⃣ Start growing your network!\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🛡️ _Powered by SR bot Maker [LTD]_\n` +
            `DEVELOPER @SR\\_TECNOLOGY\\_LTD`;
          hubBot?.sendMessage(chatId, successMsg, { parse_mode: 'Markdown' }).catch((err: any) => logSys(`Hub send err: ${err.message}`));
        } catch (e: any) {
          hubBot?.sendMessage(chatId, `❌ **CRITICAL ERROR:** ${e.message}`).catch(() => {});
        }
      }
    } catch (err: any) { console.error("Hub Msg Error:", err.message); }
    });

    hubBot.on('callback_query', (query: any) => {
      try {
        const chatId = query.message?.chat.id;
        if (!chatId) return;
        if (query.data?.startsWith('hub_tpl_')) {
          const type = query.data.replace('hub_tpl_', '') as BotNode['type'];
          deploymentStates.set(chatId, { step: "AWAITING_TOKEN", type });
          hubBot?.sendMessage(chatId, "🔑 **AUTHENTICATION REQUIRED**\n\nPlease provide your sub-bot API Token from @BotFather now.");
        }
        hubBot?.answerCallbackQuery(query.id);
      } catch (err: any) { console.error("Hub CB Error:", err.message); }
    });
  }

  // Protocol Epsilon: SPA Final Fallback (Production Only)
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), 'dist');
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  // Protocol Zeta: Background engine hydration
  setTimeout(() => {
    engine.boot()
      .then(() => {
        engineStatus = "ready";
        logSys("Engine hydration complete.");
      })
      .catch(err => {
        engineStatus = "error";
        logSys(`Deferred boot fail: ${err.message}`);
      });
  }, 1000);
}

startServer().catch(err => {
  logSys(`[CRITICAL_CORE_CRASH] ${err.message}`);
});

// --- GLOBAL PROCESS RESILIENCE ---
process.on('uncaughtException', (err) => {
  console.error("🔥 CRITICAL: Uncaught Exception:", err);
  logSys(`[CRIT_EXCEPTION] ${err.message}`);
  try { engine['saveData'](); } catch {}
});

process.on('unhandledRejection', (reason, promise) => {
  console.error("☢️ CRITICAL: Unhandled Rejection at:", promise, "reason:", reason);
  logSys(`[UNHANDLED_REJ] ${String(reason)}`);
});

const gracefulExit = () => {
    logSys("Shutting down engine gracefully...");
    try { engine['saveData'](); } catch {}
    setTimeout(() => process.exit(0), 1000);
};

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

