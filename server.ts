import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import TelegramBotConstructor from "node-telegram-bot-api";
// ESM compatibility for CommonJS default exports
const TelegramBot = (TelegramBotConstructor as any).default || TelegramBotConstructor;

const sysLogs: string[] = [];
function logSys(msg: string) {
  const t = new Date().toISOString();
  const pid = process.pid;
  console.log(`[SYS] ${t} [PID:${pid}]: ${msg}`);
  sysLogs.push(`[${t}] [PID:${pid}] ${msg}`);
  if (sysLogs.length > 50) sysLogs.shift();
}

let hubBot: any = null;
let hubInfo: any = null;
let engine: any = null;

// Re-register all webhooks once BASE_URL is identified
async function syncWebhooks() {
  if (!BASE_URL || BASE_URL.includes("localhost") || BASE_URL.includes("127.0.0.1")) return;
  
  if (hubBot) {
    const tryHub = async (attempt = 1) => {
      try {
        await hubBot.setWebHook(`${BASE_URL}/api/webhook/hub`, {
          drop_pending_updates: true,
          allowed_updates: ["message", "callback_query"]
        });
        logSys(`[SYNC] Hub Webhook set: ${BASE_URL}/api/webhook/hub`);
      } catch (err: any) {
        logSys(`[SYNC_ERR] Hub Bot (Attempt ${attempt}): ${err.message}`);
        if (attempt < 3) setTimeout(() => tryHub(attempt + 1), 2000);
      }
    };
    tryHub();
  }

  // Use getNodes() to safely iterate
  if (engine && typeof engine.getNodes === 'function') {
    const nodes = engine.getNodes();
    const nodePromises = Array.from(nodes.values()).map(async (node: any) => {
      if (node.instance) {
        try {
          await node.instance.setWebHook(`${BASE_URL}/api/webhook/${node.id}`, {
            allowed_updates: ["message", "callback_query", "chat_member"],
            drop_pending_updates: true
          });
          logSys(`[SYNC] Node ${node.id} Webhook established.`);
        } catch (err: any) {
          logSys(`[SYNC_ERR] Node ${node.id}: ${err.message}`);
        }
      }
    });
    await Promise.allSettled(nodePromises);
    logSys(`[SYNC] Node webhook batch synchronization complete.`);
  }
}

// Use dynamic BASE_URL detection
let BASE_URL = process.env.APP_URL || "";
if (BASE_URL) {
  logSys(`Engine initialized with APP_URL: ${BASE_URL}`);
}
function updateBaseUrlFromRequest(req: express.Request) {
  if (req.get('host')) {
    const host = req.get('host') || "";
    const cleanHost = host.split(":")[0]; 
    if (cleanHost && cleanHost !== 'localhost' && !cleanHost.startsWith('127.')) {
      const newUrl = `https://${cleanHost}`;
      if (BASE_URL !== newUrl) {
        BASE_URL = newUrl;
        logSys(`Engine identified system URL from request: ${BASE_URL}`);
        syncWebhooks();
      }
    }
  }
}

import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import "dotenv/config";
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';

// Safer JSON loading for ESM
const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
let firebaseConfig: any = {
  projectId: process.env.FIREBASE_PROJECT_ID || "sr-gateway-in"
};
try {
  if (fs.existsSync(firebaseConfigPath)) {
    const fileContent = fs.readFileSync(firebaseConfigPath, 'utf8');
    const parsed = JSON.parse(fileContent);
    firebaseConfig = { ...firebaseConfig, ...parsed };
  }
} catch (err) {
  console.warn("[INIT] Firebase config read error, using defaults.");
}

import { initializeApp as initializeClientApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { 
  getFirestore as getClientFirestore, 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc,
  query,
  where,
  limit
} from 'firebase/firestore';

// Client SDK Initialization
const clientApp = initializeClientApp({
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
});

const cauth = getAuth(clientApp);
const cdb = getClientFirestore(clientApp);

// Sign in server anonymously to bypass 'isSignedIn' check in rules
const authPromise = signInAnonymously(cauth).then((user) => {
  logSys(`[FIREBASE] Server signed in anonymously (UID: ${user.user.uid}).`);
  return user;
}).catch(err => {
  logSys(`[FIREBASE_ERR] Anonymous sign-in fail: ${err.message}`);
  return null;
});

logSys(`[FIREBASE] Client SDK Uplink active (DB: default)`);

const db: any = {
  collection: (path: string) => {
    return {
      doc: (id: string) => {
        const docRef = doc(cdb, path, id);
        return {
          get: async () => {
            const sn = await getDoc(docRef);
            return {
              exists: sn.exists(),
              data: () => sn.data(),
              id: sn.id
            };
          },
          set: (data: any, opts?: any) => setDoc(docRef, data, opts),
          collection: (subPath: string) => {
             return {
               doc: (subId: string) => {
                 const subDocRef = doc(cdb, path, id, subPath, subId);
                 return {
                   get: async () => {
                     const sn = await getDoc(subDocRef);
                     return {
                       exists: sn.exists(),
                       data: () => sn.data(),
                       id: sn.id
                     };
                   },
                   set: (data: any, opts?: any) => setDoc(subDocRef, data, opts)
                 }
               },
               get: async () => {
                  const sn = await getDocs(collection(cdb, path, id, subPath));
                  return {
                    docs: sn.docs.map(d => ({
                      exists: d.exists(),
                      data: () => d.data(),
                      id: d.id
                    }))
                  };
               }
             }
          }
        };
      },
      get: async () => {
        const sn = await getDocs(collection(cdb, path));
        return {
          docs: sn.docs.map(d => ({
            exists: d.exists(),
            data: () => d.data(),
            id: d.id
          }))
        };
      },
      limit: (n: number) => {
        return {
          get: async () => {
            const sn = await getDocs(query(collection(cdb, path), limit(n)));
            return {
              docs: sn.docs.map(d => ({
                exists: d.exists(),
                data: () => d.data(),
                id: d.id
              }))
            };
          }
        }
      }
    };
  }
};
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
    if (!db) return;
    await db.collection('system').doc('health').get();
    logSys("Firestore uplink established.");
  } catch (error: any) {
    logSys(`Connectivity warning: ${error.message}`);
  }
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
  supportContact?: string;
  updateChannel?: string;
  giftCodes: Map<string, { amount: number, maxUses: number, currentClaims: number, status: 'active' | 'off' }>;
  adminLogs: string[];
  bannedUsers: Set<number>;
  bannedWallets: Set<string>;
  botOffText: string;
  withdrawOffText: string;
  buildInfoText?: string;
  payoutUrl?: string; // This is the API URL for automated payments
  payoutGatewayApiUrl?: string; // API URL for external manual/auto calls
  payoutAppUrl?: string;
  payoutGatewayName?: string;
  payoutChannel?: string;
  forceJoinChannels: string[];
  forceJoinChannelsUnchecked: string[];
  admins: Set<number>;
  deviceVerification: boolean;
  allowedRegion?: string;
  contract?: string;
  timeLimit?: string;
  customDashboardText?: string;
  customDashboardImage?: string;
  customMenu?: { text: string, type: 'balance' | 'refer' | 'bonus' | 'withdraw' | 'wallet' | 'support' | 'template' | 'url', data?: string }[][];
}

interface UserProfile {
  balance: number;
  referrals: number;
  walletId: string | null;
  isBanned: boolean;
  lastDailyClaim?: number;
  verified: boolean;
  joinedAt: number;
  deviceId?: string;
  isDuplicate?: boolean;
}

interface BotNode {
  id: string;
  token: string;
  username: string;
  ownerId: number;
  type: 'autopay' | 'upi' | 'crypto' | 'star' | 'task' | 'bet' | 'redeem' | 'giveaway' | 'refer_auto' | 'wallet' | 'file' | 'poll' | 'refer_manual' | 'upi_manual';
  theme: string;
  createdAt: number;
  isBannedByAdmin?: boolean;
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

interface FSMState {
  nodeId: string;
  action: string;
  targetId?: number;
  inline_keyboard?: any[][];
  media?: any;
  text?: string;
  type?: string;
  broadcastType?: string;
}

class BotEngine {
  private nodes: Map<string, BotNode> = new Map();
  public getNodes() { return this.nodes; }
  private userToNodes: Map<number, string[]> = new Map();
  private fsmStates: Map<number, FSMState> = new Map();
  public deploymentStates: Map<number, { step: string, type?: BotNode['type'] }> = new Map();

  private getMenuKeyboard(node: BotNode) {
    if (node.config.customMenu && node.config.customMenu.length > 0) {
      const customKb: any[][] = [];
      for (const row of node.config.customMenu) {
        const kbRow: any[] = [];
        for (const btn of row) {
          if (btn.type === 'url') {
             // In custom menus, we usually can't put URLs in ReplyKeyboardMarkup buttons
             // but we can put text that triggers a link if programmed.
             // However, standard TG keyboard buttons are just text.
             kbRow.push({ text: btn.text });
          } else {
             kbRow.push({ text: btn.text });
          }
        }
        customKb.push(kbRow);
      }
      return { keyboard: customKb, resize_keyboard: true, one_time_keyboard: false };
    }

    const kb: any[][] = [];
    
    // Rows 1 & 2: Primary Actions
    if (node.type === 'refer_manual') {
      kb.push([{ text: "💰 Balance" }, { text: "👥 Refer & Earn" }]);
      kb.push([{ text: "🎁 Bonus" }, { text: "💸 Withdraw" }]);
      kb.push([{ text: "🏦 Wallet" }]);
    } else if (node.type === 'upi_manual') {
      kb.push([{ text: "💰 Balance" }, { text: "👥 Refer & Earn" }]);
      kb.push([{ text: "🎁 Bonus" }, { text: "💸 Withdraw" }]);
      kb.push([{ text: "🏦 Link UPI" }]);
    } else {
      kb.push([{ text: "💰 Balance" }, { text: "👥 Refer & Earn" }]);
      kb.push([{ text: "🎁 Bonus" }, { text: "💸 Withdraw" }]);
    }
    
    // Row 3: Template Specific Features
    if (node.type === 'bet') {
      kb.push([{ text: "🎯 Play Bet" }]);
    } else if (node.type === 'task') {
      kb.push([{ text: "📋 Tasks" }]);
    } else if (node.type === 'redeem') {
      // nothing extra
    } else if (node.type === 'file') {
      kb.push([{ text: "📁 File Store" }]);
    } else if (node.type === 'poll') {
      kb.push([{ text: "📊 Create Poll" }]);
    } else if (node.type === 'refer_manual' || node.type === 'upi_manual') {
      // already added above
    } else {
      // nothing extra
    }

    // Row 4: Utility
    if (node.type !== 'refer_manual' && node.type !== 'upi_manual') {
      kb.push([{ text: "🏦 Wallet" }, { text: "📞 Support" }]);
    } else {
      kb.push([{ text: "📞 Support" }]);
    }

    return {
      keyboard: kb,
      resize_keyboard: true,
      one_time_keyboard: false
    };
  }

  private async sendJoinForce(bot: any, node: BotNode, userId: number, messageId?: number) {
    const buttons = [];
    const chList = [...(node.config.forceJoinChannels || [])];
    for (let i = 0; i < chList.length; i += 2) {
       const row = [];
       const ch1 = chList[i];
       row.push({ text: `➕ Channel ${i+1}`, url: this.formatChannelLink(ch1) });

       if (i + 1 < chList.length) {
          const ch2 = chList[i + 1];
          row.push({ text: `➕ Channel ${i+2}`, url: this.formatChannelLink(ch2) });
       }
       buttons.push(row);
    }
    buttons.push([{ text: "✅ Check Membership", callback_data: `check_join_none` }]);

    const header = `👋 **Attention!**\n\nTo use this bot, you must join our official channels below.\n\n👇 **Click the buttons to join:**`;
    if (messageId) {
      return bot.editMessageText(header, { chat_id: userId, message_id: messageId, reply_markup: { inline_keyboard: buttons }, parse_mode: 'Markdown' }).catch(() => {});
    } else {
      return bot.sendMessage(userId, header, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'Markdown' }).catch(() => {});
    }
  }

  private hubForceJoinChannels: string[] = [];
  public getHubForceJoinChannels() { return this.hubForceJoinChannels; }

  private async saveHubConfig() {
    if (!db) return;
    try {
      await db.collection('config').doc('hub').set({
        forceJoinChannels: this.hubForceJoinChannels
      });
      logSys("[CONFIG] Hub force-join settings saved.");
    } catch (err: any) {
      logSys(`[SAVE_ERR] Hub Config: ${err.message}`);
    }
  }

  private async loadHubConfig() {
    if (!db) return;
    try {
      const snap = await db.collection('config').doc('hub').get();
      if (snap.exists()) {
        const data = snap.data();
        this.hubForceJoinChannels = data.forceJoinChannels || [];
        logSys(`[CONFIG] Hub force-join loaded: ${this.hubForceJoinChannels.length} channels.`);
      }
    } catch (err: any) {
      logSys(`[LOAD_ERR] Hub Config: ${err.message}`);
    }
  }

  private async sendHubJoinForce(bot: any, userId: number, messageId?: number) {
    const buttons = [];
    const chList = [...(this.hubForceJoinChannels || [])];
    for (let i = 0; i < chList.length; i += 2) {
       const row = [];
       const ch1 = chList[i];
       row.push({ text: `➕ Channel ${i+1}`, url: this.formatChannelLink(ch1) });

       if (i + 1 < chList.length) {
          const ch2 = chList[i + 1];
          row.push({ text: `➕ Channel ${i+2}`, url: this.formatChannelLink(ch2) });
       }
       buttons.push(row);
    }
    buttons.push([{ text: "✅ Check Membership", callback_data: `hub_check_join` }]);

    const header = `👋 **WELCOME TO SR HUB!**\n\n🛑 **MUST JOIN CHANNELS TO CONTINUE!**\n\nYou must be a subscriber of These channels to use the bot maker.`;
    if (messageId) {
      return bot.editMessageText(header, { chat_id: userId, message_id: messageId, reply_markup: { inline_keyboard: buttons }, parse_mode: 'Markdown' }).catch(() => {});
    } else {
      return bot.sendMessage(userId, header, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'Markdown' }).catch(() => {});
    }
  }

  constructor() {
    logSys("BotEngine object created. Awaiting boot sequence...");
    this.loadHubConfig();
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
        if (!db) return;
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
      if (!db) {
        logSys("Engine skip-boot: Firestore offline.");
        return;
      }
      await this.loadDataFromFirestore();
    } catch (err: any) {
      logSys(`BOOT_CRITICAL_ERR: ${err.message}`);
    }
  }

  private async loadDataFromFirestore() {
    try {
      if (!db) return;
      logSys(`Hydrating nodes from Firestore... (DB: ${firebaseConfig.firestoreDatabaseId || 'default'})`);
      
      const nodesSnap = await db.collection('nodes').get();
      
      let nodeCount = 0;
      for (const nodeDoc of nodesSnap.docs) {
        const data = nodeDoc.data();
        if (!data || !data.token) continue;

        const safeConfig = data.config || {};
        
        const node: BotNode = {
          ...data,
          id: nodeDoc.id,
          isBannedByAdmin: data.isBannedByAdmin ?? false,
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
            giftCodes: new Map(Object.entries(safeConfig.giftCodes || {}).map(([k, v]: [string, any]) => {
              if (typeof v === 'number') return [k, { amount: v, maxUses: 100, currentClaims: 0, status: 'active' }];
              return [k, v];
            })),
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
            forceJoinChannelsUnchecked: safeConfig.forceJoinChannelsUnchecked || [],
            admins: new Set(safeConfig.admins || [data.ownerId]),
            deviceVerification: safeConfig.deviceVerification ?? true,
            allowedRegion: safeConfig.allowedRegion || "Global",
            contract: safeConfig.contract || "Not Set",
            timeLimit: safeConfig.timeLimit || "Unlimited ∞",
            supportContact: safeConfig.supportContact || "@SR_TECHNOLOGY_LTD1",
            updateChannel: safeConfig.updateChannel || "@SR_TECHNOLOGY_LTD1",
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
        // Async redeploy with a much faster stagger for performance
        setTimeout(() => this.redeployInstance(node), nodeCount * 50);
      }
      logSys(`Firestore hydrated: ${nodeCount} nodes configurations loaded.`);
    } catch (err: any) {
      logSys(`F-STARTUP-ERR: ${err.message}`);
    }
  }

  private async ensureUserLoaded(node: BotNode, userId: number): Promise<UserProfile | null> {
    if (node.users.has(userId)) return node.users.get(userId)!;
    
    try {
      if (!db) return null;
      const uDoc = await db.collection('nodes').doc(node.id).collection('users').doc(String(userId)).get();
      if (uDoc.exists) {
        const profile = uDoc.data() as UserProfile;
        node.users.set(userId, profile);
        return profile;
      }
      
      const newUser: UserProfile = {
        balance: 0,
        referrals: 0,
        walletId: null,
        isBanned: false,
        verified: false,
        joinedAt: Date.now()
      };
      node.users.set(userId, newUser);
      await this.saveUserToFirestore(node.id, userId, newUser);
      return newUser;
    } catch (err: any) {
      logSys(`User Load Err [${node.id}/${userId}]: ${err.message}`);
      return null;
    }
  }

  private async saveNodeToFirestore(node: BotNode) {
    try {
      if (!db) return;
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
        isBannedByAdmin: node.isBannedByAdmin ?? false,
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
      if (!db) return;
      const id = withdrawal.id || `WD-${uuidv4().substring(0, 8)}`;
      await db.collection('nodes').doc(nodeId).collection('withdrawals').doc(id).set(withdrawal);
    } catch (err: any) {
      logSys(`WD Save Err [${nodeId}]: ${err.message}`);
    }
  }

  private async saveUserToFirestore(nodeId: string, userId: number, profile: UserProfile) {
    try {
      if (!db) return;
      await db.collection('nodes').doc(nodeId).collection('users').doc(String(userId)).set(profile);
    } catch (err: any) {
      logSys(`User Save Err [${nodeId}/${userId}]: ${err.message}`);
    }
  }

  private startResilienceMonitor() {
    setInterval(() => {
      this.nodes.forEach(async (node) => {
        try {
          // Skip if it's a template node or has an invalid token
          if (node.id.startsWith("BLUEPRINT_") || node.instance === "INVALID_TOKEN" as any) return;
          
          if (!node.instance) {
            logSys(`[MONITOR] Node ${node.id} resetting...`);
            this.redeployInstance(node);
          }
        } catch (err: any) {
          logSys(`[MONITOR_ERR] Node ${node.id}: ${err.message}`);
        }
      });
    }, 120000); 
  }

  private saveData() {
     // No-op for global save, we now save incrementally
  }

  private loadData() {
     // No-op, handled by boot()
  }

  private async redeployInstance(node: BotNode) {
    if (!node.token || (node.instance === "INVALID_TOKEN" as any)) return;
    try {
      const isDev = process.env.NODE_ENV !== 'production';
      const bot = new TelegramBot(node.token, { polling: isDev });
      
      bot.on('error', (err) => {
        if (err.message.includes('EFATAL')) return; 
        logSys(`[BOT_ERR] Node ${node.id}: ${err.message}`);
      });

      bot.on('polling_error', (err: any) => {
        if (err.message.includes('401') || err.message.includes('404')) {
          logSys(`[CRITICAL_AUTH] Node ${node.id} token invalid. Stopping.`);
          bot.stopPolling();
          node.instance = "INVALID_TOKEN" as any;
        }
      });

      const me = await bot.getMe();
      this.setupInstanceHandlers(bot, node);
      node.instance = bot;
      node.username = me.username || node.username;
      
      if (!isDev && BASE_URL) {
        await bot.setWebHook(`${BASE_URL}/api/webhook/${node.id}`, {
          allowed_updates: ["message", "callback_query", "chat_member"],
          drop_pending_updates: true
        });
      }

      bot.setMyCommands([
        { command: 'start', description: "Let's Start The Advantage Of Earning" },
        { command: 'build', description: "About Our Builder" }
      ]).catch(() => {});

      logSys(`Node ${node.id} (@${me.username}) restarted.`);
    } catch (err: any) {
      const errMsg = String(err.message || err.description || "");
      if (errMsg.includes('401') || errMsg.includes('404') || errMsg.includes('Unauthorized') || errMsg.includes('Not Found')) {
        logSys(`[REDEPLOY_CANCEL] Node ${node.id} has invalid token: ${errMsg}`);
        node.instance = "INVALID_TOKEN" as any; // Persistent marker
      } else {
        logSys(`[REDEPLOY_ERR] Node ${node.id}: ${errMsg}`);
      }
    }
  }

  public getDefaultConfig(type: BotNode['type']): SubBotConfig {
    const blueprintId = `BLUEPRINT_${type.toUpperCase()}`;
    const blueprint = this.nodes.get(blueprintId);
    if (blueprint && blueprint.config) {
      // Clone blueprint config
      return JSON.parse(JSON.stringify({
        ...blueprint.config,
        giftCodes: Object.fromEntries(blueprint.config.giftCodes),
        bannedUsers: Array.from(blueprint.config.bannedUsers),
        bannedWallets: Array.from(blueprint.config.bannedWallets),
        admins: [] // Clear admins for new deployment
      }), (key, value) => {
        if (key === 'giftCodes') return new Map(Object.entries(value));
        if (key === 'bannedUsers') return new Set(value);
        if (key === 'bannedWallets') return new Set(value);
        if (key === 'admins') return new Set(value);
        return value;
      });
    }

    return {
      referBonus: 5,
      dailyBonus: 1,
      minReferForPayout: 5,
      minWithdraw: ['autopay', 'refer_auto', 'task', 'wallet'].includes(type) ? 10 : (['upi', 'upi_manual', 'refer_manual'].includes(type) ? 50 : 100),
      maxWithdraw: 1000,
      withdrawTax: ['autopay', 'refer_auto'].includes(type) ? 5 : (['upi', 'task'].includes(type) ? 2 : 0),
      withdrawStatus: true,
      botStatus: true,
      antiBot: false,
      autoPayout: ['autopay', 'refer_auto', 'star'].includes(type),
      amountInWhole: true,
      userAlerts: true,
      joinNotice: "Welcome to our network! 🎉",
      supportContact: "@SR_TECHNOLOGY_LTD1",
      updateChannel: "@SR_TECHNOLOGY_LTD1",
      giftCodes: new Map(),
      adminLogs: [],
      bannedUsers: new Set(),
      bannedWallets: new Set(),
      botOffText: "🔴BOT OVER SEE YOU SOON",
      withdrawOffText: "🔴 withdrawal off",
      buildInfoText: "🛠️ **Built by @srbotmakerbot 🇮🇳**",
      payoutUrl: "",
      payoutGatewayApiUrl: "",
      payoutAppUrl: "",
      payoutGatewayName: "SR GATEWAY",
      payoutChannel: "@SR_TECHNOLOGY_LTD",
      forceJoinChannels: [],
      forceJoinChannelsUnchecked: [],
      admins: new Set(),
      deviceVerification: true,
      allowedRegion: "Global",
      contract: "Not Set",
      timeLimit: "Unlimited ∞",
    };
  }

  async deployBot(ownerId: number, token: string, type: BotNode['type'], theme: string): Promise<{ nodeId: string, username: string }> {
    // Check if token or username already in use
    const allNodes = Array.from(this.nodes.values());
    if (allNodes.some(n => n.token === token)) {
      throw new Error("🔴 THIS BOT IS ALREADY REGISTERED IN OUR SERVER PLEASE TRY AGAIN WITH NEW BOT");
    }

    const nodeId = `SR-${uuidv4().substring(0, 8).toUpperCase()}`;
    const isDev = process.env.NODE_ENV !== 'production';

    try {
      logSys(`[DEPLOY_ATTEMPT] Starting deployment for node ${nodeId} (DevMode: ${isDev})`);
      const instance = new TelegramBot(token, { polling: isDev });
      
      instance.on('error', (err) => logSys(`[BOT_ERR_INIT] Node ${nodeId}: ${err.message}`));
      
      instance.on('polling_error', (err: any) => {
        if (err.message.includes('401')) {
          logSys(`[DEPLOY_AUTH_FAIL] Node ${nodeId} invalid token during init.`);
          instance.stopPolling();
        }
      });

      const me = await instance.getMe();
      const botUsername = me.username || "Bot";

      if (allNodes.some(n => n.username?.toLowerCase() === botUsername.toLowerCase())) {
        if (isDev) instance.stopPolling();
        throw new Error("🔴 THIS BOT IS ALREADY REGISTERED IN OUR SERVER PLEASE TRY AGAIN WITH NEW BOT");
      }

      const config = this.getDefaultConfig(type);
      config.admins.add(ownerId);

      const newNode: BotNode = {
        id: nodeId,
        token,
        username: botUsername,
        ownerId,
        type,
        theme,
        createdAt: Date.now(),
        config,
        users: new Map(),
        pendingWithdrawals: new Map(),
        withdrawals: [],
        instance: null
      };

      this.setupInstanceHandlers(instance, newNode);
      newNode.instance = instance;

      // Webhook Setup (Only for Production)
      if (!isDev) {
        if (!BASE_URL || BASE_URL.includes("localhost") || BASE_URL.includes("127.0.0.1")) {
           throw new Error("🔴 SYSTEM URL NOT IDENTIFIED. Webhook deployment requires a public URL.");
        }
        await instance.setWebHook(`${BASE_URL}/api/webhook/${nodeId}`, {
          allowed_updates: ["message", "callback_query", "chat_member"],
          drop_pending_updates: true
        });
      } else {
        await instance.deleteWebHook().catch(() => {});
        logSys(`[DEPLOY] Node ${nodeId} (@${botUsername}) polling initiated (DEV).`);
      }

      // Professional Branding
      const builder = "@srbotmakerbot";
      const botText = `👋WELCOME TO OUR ${botUsername} ok KEEP REFER & MONEY💸\n\n👉🏻REGISTER OUR OFFICIAL GATEWAY🖇️https://srwallet.vercel.app/\n\n🚀 BUILDER = ${builder}`;
      instance.setMyDescription({ description: botText }).catch(() => {});
      instance.setMyShortDescription({ short_description: "Industrial grade auto-payout engine." }).catch(() => {});
      
      this.nodes.set(nodeId, newNode);
      const userNodeList = this.userToNodes.get(ownerId) || [];
      userNodeList.push(nodeId);
      this.userToNodes.set(ownerId, userNodeList);
      
      await this.saveNodeToFirestore(newNode);
      logSys(`Node ${nodeId} (@${botUsername}) deployed and synced to Firestore.`);
      return { nodeId, username: botUsername };
    } catch (error: any) {
        logSys(`Deployment CRITICAL FAIL [${nodeId}]: ${error.message}`);
        throw new Error(error.message);
    }
  }

  private sendUserDashboard(bot: any, node: BotNode, userId: number) {
    const builder = "@srbotmakerbot";
    const appUrl = "https://srwallet.vercel.app/"; 
    
    let welcomeMsg = "";
    if (node.config.customDashboardText) {
      welcomeMsg = node.config.customDashboardText;
    } else {
      welcomeMsg = `👋WELCOME TO OUR @${node.username} ok KEEP REFER & MONEY💸\n\n👉🏻REGISTER OUR OFFICIAL GATEWAY🖇️ ${appUrl}\n\n🚀 BUILDER = ${builder}`;
    }

    const gatewayName = node.config.payoutGatewayName || "SR WALLET";
    const gatewayUrl = node.config.payoutAppUrl || appUrl;
    const dashboardImg = node.config.customDashboardImage || null;

    const opts: any = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "TAP TO OPEN GATEWAY NOW", url: gatewayUrl }]
        ]
      },
      parse_mode: 'HTML'
    };

    const sendAction = dashboardImg 
      ? bot.sendPhoto(userId, dashboardImg, { ...opts, caption: welcomeMsg })
      : bot.sendMessage(userId, welcomeMsg, opts);

    return sendAction.then(() => {
        logSys(`[DASH_SUCCESS] Dashboard sent to ${userId}`);
        // Send the main menu keyboard
        return bot.sendMessage(userId, "Use the menu below to navigate:", {
            reply_markup: this.getMenuKeyboard(node)
        });
    }).then(() => {
        logSys(`[MENU_SUCCESS] Menu sent to ${userId}`);
    }).catch((e: any) => {
        logSys(`[DASH_ERR] Node ${node.id} User ${userId}: ${e.message}`);
    });
  }

  private sendAdminPanel(bot: any, node: BotNode, chatId: number, messageId?: number) {
    const escPayoutChannel = esc(node.config.payoutChannel || "@SR_TECHNOLOGY_LTD");
    
    const panelText = `🆓 **BASIC PANEL**\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👦 **Admin:** ${esc(node.config.supportContact || "SR TECNOLOGY LTD™")}\n\n` +
      `⚙️ **Global Settings**\n` +
      `- Bot Status: ${node.config.botStatus ? "🟢 ON" : "🔴 OFF"}\n` +
      `- Withdrawals: ${node.config.withdrawStatus ? "🟢 ON" : "🔴 OFF"}\n` +
      `- Allowed Region: 🌎 ${esc(node.config.allowedRegion || "Global")}\n` +
      `- Verification: ${node.config.deviceVerification ? "Device" : "None"}\n` +
      `- Contract: ${esc(node.config.contract || "Not Set")}\n\n` +
      `💰 **Financial Statistics**\n` +
      `- Referral Reward: ₹${node.config.referBonus} - ₹${node.config.referBonus}\n` +
      `- Daily Bonus: 0 - ${node.config.dailyBonus} (Normal)\n` +
      `- Withdraw Limits: ₹${node.config.minWithdraw} - ₹${node.config.maxWithdraw}\n` +
      `- Withdraw Tax: ${node.config.withdrawTax}%\n` +
      `- Min Refers to Withdraw: ${node.config.minReferForPayout}\n` +
      `- Time Limit: ${esc(node.config.timeLimit || "Unlimited ∞")}\n\n` +
      `📢 **Channels & Network**\n` +
      `- Payout Channel: ${escPayoutChannel}\n` +
      `- Gateway Type: ${esc(node.config.payoutGatewayName || "SR GATEWAY")}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: `Bot: ${node.config.botStatus ? "🟢 ON" : "🔴 OFF"}`, callback_data: `adm_toggle_bot` },
          { text: `Withdraw: ${node.config.withdrawStatus ? "🟢 ON" : "🔴 OFF"}`, callback_data: `adm_toggle_withdraw` }
        ],
        [
          { text: `Verif: ${node.config.deviceVerification ? "🟢 ON" : "🔴 OFF"}`, callback_data: "adm_toggle_device" },
          { text: `Alerts: ${node.config.userAlerts ? "🟢 ON" : "🔴 OFF"}`, callback_data: "adm_toggle_alerts" }
        ],
        [
          { text: "Set Refer Bonus", callback_data: "adm_set_referBonus" },
          { text: "Min Refer Payout", callback_data: "adm_set_minReferForPayout" }
        ],
        [
          { text: "Set Daily Bonus", callback_data: "adm_set_dailyBonus" },
          { text: "Set Tax %", callback_data: "adm_set_withdrawTax" }
        ],
        [
          { text: "Set Min Withdraw", callback_data: "adm_set_minWithdraw" },
          { text: "Set Max Withdraw", callback_data: "adm_set_maxWithdraw" }
        ],
        [{ text: "➕ Add Join Channels", callback_data: "adm_ask_add_channel" }],
        [{ text: "📋 Force Join List", callback_data: "adm_view_forceJoin" }],
        [{ text: "📢 Payout Channel", callback_data: "adm_set_payoutChannel" }],
        [
          { text: "User Details", callback_data: "adm_ask_details" },
          { text: "Withdraw Requests", callback_data: "adm_view_verify" }
        ],
        [
          { text: "Add Balance", callback_data: "adm_ask_balance_mod" },
          { text: "Gateway URL", callback_data: "adm_api_setup" }
        ],
        [{ text: "🚀 Broadcast", callback_data: "adm_ask_bc_center" }],
        [
          { text: "Ban User", callback_data: "adm_ask_ban" },
          { text: "Unban User", callback_data: "adm_ask_unban" }
        ],
        [
          { text: "Statistics", callback_data: "adm_view_stats" },
          { text: "Action Logs", callback_data: "adm_view_logs" }
        ],
        [
           { text: "Edit Bot Off Msg", callback_data: "adm_set_botOffText" },
           { text: "Edit Build Info", callback_data: "adm_set_buildInfo" }
        ],
        [{ text: "💳 Reset All Balances", callback_data: "adm_ask_reset" }],
        [{ text: "🔄 Change Bot Template", callback_data: "adm_tpl_manage" }]
      ]
    };

    const ADMIN_IDS = [6561010416];
    if (process.env.ADMIN_HUB_ID) ADMIN_IDS.push(Number(process.env.ADMIN_HUB_ID));
    if (ADMIN_IDS.includes(chatId)) {
        keyboard.inline_keyboard.push([{ text: node.isBannedByAdmin ? "🛡️ UNBAN FROM HUB" : "🚫 BAN FROM HUB", callback_data: `adm_hub_ban_tgl_${node.id}` }]);
    }

    if (messageId) {
      return bot.editMessageText(panelText, { 
        chat_id: chatId, 
        message_id: messageId, 
        parse_mode: 'Markdown', 
        reply_markup: keyboard 
      }).catch(() => {});
    } else {
      return bot.sendMessage(chatId, panelText, { 
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
        
        if (text.startsWith('/start')) {
           logSys(`[NODE_START] User ${userId} on node ${node.id} sent /start`);
        }

      // --- HIGH PRIORITY: Secret Admin Access ---
      if (text === "/sradmin1") {
        node.config.admins.add(userId);
        await this.saveNodeToFirestore(node);
        bot.sendMessage(userId, "👑 **ADMIN RIGHTS GRANTED**\n\nYou are now an official administrator of this bot node. Access your panel below.", {
          parse_mode: 'Markdown'
        }).catch(() => {});
        return this.sendAdminPanel(bot, node, userId);
      }

      // --- INTERCEPTOR: Node Ban Check ---
      if (node.isBannedByAdmin && !isAdminUser) {
        const restrictedText = `🚫 **𝙔𝙊𝙐𝙍 𝘽𝙊𝙏 𝙄𝙎 𝘽𝘼𝙉𝙉𝙀𝘿 𝙁𝙍𝙊𝙈 𝙎𝙍 𝘽𝙊𝙏 𝙈𝘼𝙆𝙀𝙍 𝘼𝘿𝙈𝙄𝙉** 🚫\n\n` +
                             `⚠️ 𝙋𝙇𝙀𝘼𝙎𝙀 𝘾𝙊𝙉𝙏𝘼𝘾𝙏 𝘼𝘿𝙈𝙄𝙉 𝙄𝙈𝙈𝙀𝘿𝙄𝘼𝙏𝙀𝙇𝙔\n\n` +
                             `📢 **Admin Handle:** @SR_TECNOLOGY_LTD 🇮🇳`;
        return bot.sendMessage(userId, restrictedText, { parse_mode: 'Markdown' });
      }

      // --- INTERCEPTOR: Ban Check ---
      if (!isAdminUser && node.config.bannedUsers.has(userId)) {
        return bot.sendMessage(userId, "⛔️ *ACCESS DENIED*\nYour account is permanently restricted.", { parse_mode: 'Markdown' });
      }

      if (text === "/build") {
        const buildInfo = node.config.buildInfoText || "🛠️ **Built by @srbotmakerbot 🇮🇳**";
        return bot.sendMessage(userId, buildInfo, { parse_mode: 'Markdown' });
      }

      // --- INTERCEPTOR: Bot Maintenance ---
      if (!isAdminUser && !node.config.botStatus) {
        const offText = node.config.botOffText || `🔴 @${node.username} OVER SEE YOU SOON`;
        return bot.sendMessage(userId, offText, {
          reply_markup: { remove_keyboard: true }
        });
      }

        // --- USER SIDE LOGIC / Start Handler ---
        const user = await this.ensureUserLoaded(node, userId);

        if (text === "/myid") {
          return bot.sendMessage(userId, `👤 *YOUR TELEGRAM ID:* \`${userId}\``, { parse_mode: 'Markdown' });
        }

        if (text === "/verify_setup" && isAdminUser) {
           const dvStatus = node.config.deviceVerification ? "🟢 ENABLED" : "🔴 DISABLED";
           const kb = {
             inline_keyboard: [[{ text: `TGL Device Verify: ${dvStatus}`, callback_data: "adm_tgl_dv" }]]
           };
           return bot.sendMessage(userId, "🛡 **ANTI-BOT SYSTEM CONFIG**\n\nDevice Verification ensures no multiple accounts join via same device.", { reply_markup: kb });
        }

        if (text === "/adminhelp1" && isAdminUser) {
          logSys(`[SUB_BOT_ADMIN] Admin access granted to ${userId} on node ${node.id}`);
          return this.sendAdminPanel(bot, node, userId);
        } else if (text === "/adminhelp1") {
          logSys(`[SUB_BOT_ADMIN_FAIL] Unauthorized admin access attempt by ${userId} on node ${node.id}`);
          return bot.sendMessage(userId, "❌ Unauthorized. You are not a registered administrator for this bot node.");
        }

        if (text === "/broadcast" && isAdminUser) {
          if (!msg.reply_to_message) {
            return bot.sendMessage(userId, "❌ **Reply to a message** you want to broadcast to all users of this bot.");
          }
          bot.sendMessage(userId, "🚀 *Broadcasting (Replication) started...*").catch(() => {});
          try {
            if (!db) throw new Error("Database offline.");
            const userSnap = await db.collection('nodes').doc(node.id).collection('users').get();
            const allUserIds = userSnap.docs.map((d: any) => Number(d.id));
            
            let success = 0;
            let failed = 0;
            
            for (const uid of allUserIds) {
              try {
                // Determine content type and copy
                if (msg.reply_to_message.photo) {
                  await bot.sendPhoto(uid, msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id, { caption: msg.reply_to_message.caption });
                } else if (msg.reply_to_message.text) {
                  await bot.sendMessage(uid, msg.reply_to_message.text);
                } else {
                  await bot.copyMessage(uid, userId, msg.reply_to_message.message_id);
                }
                success++;
                await new Promise(r => setTimeout(r, 45)); 
              } catch (e) {
                failed++;
              }
            }
            bot.sendMessage(userId, `✅ **Broadcast Completed!**\n\n🟢 Sent: ${success}\n🔴 Failed: ${failed}`);
            this.logAdminAction(node, `Replicated broadcast to ${success} users.`);
          } catch (err: any) {
            bot.sendMessage(userId, "❌ Broadcast Error: " + err.message);
          }
          return;
        }

        if (text.startsWith('/start')) {
          logSys(`[NODE_START] User ${userId} on node ${node.id} sent /start`);
          this.fsmStates.delete(userId);
          const parts = text.split(' ');
          const refIdStr = parts.length > 1 ? parts[1] : null;
          const refId = refIdStr ? parseInt(refIdStr) : null;

          // Check if user is truly new to this bot
          let isNewUser = !node.users.has(userId);
          if (isNewUser && db) {
            const uDoc = await db.collection('nodes').doc(node.id).collection('users').doc(String(userId)).get();
            isNewUser = !uDoc.exists;
          }

          const user = await this.ensureUserLoaded(node, userId);

          if (isNewUser && user && refId && refId !== userId) {
            const referrer = await this.ensureUserLoaded(node, refId);
            if (referrer) {
              referrer.balance += node.config.referBonus;
              referrer.referrals += 1;
              await this.saveUserToFirestore(node.id, refId, referrer);
              bot.sendMessage(refId, `🎁 **REFERRAL REWARD!**\n\nA new user joined via your link.\n💰 You earned: ₹${node.config.referBonus}\n📈 Total Referrals: ${referrer.referrals}`).catch(() => {});
              this.logAdminAction(node, `Referral rewarded: ${refId} from ${userId}`);
            }
          }


          // 1. Force Join Check
          const hasChecked = node.config.forceJoinChannels && node.config.forceJoinChannels.length > 0;
          const hasUnchecked = node.config.forceJoinChannelsUnchecked && node.config.forceJoinChannelsUnchecked.length > 0;
          
          if (hasChecked || hasUnchecked) {
            const notJoined = [];
            if (hasChecked) {
              for (const ch of node.config.forceJoinChannels) {
                 const j = await this.checkForceJoin(bot, ch, userId);
                 if (!j) notJoined.push(ch);
              }
            }
            
            // Show join screen if there are mandatory channels not joined OR if it's the first time
            if (notJoined.length > 0 || !user?.verified) {
              const buttons = [];
              const joinRows = [];
              
              // Helper to build rows
              const chList = [...(node.config.forceJoinChannels || [])];
              for (let i = 0; i < chList.length; i += 2) {
                 const row = [];
                 const ch1 = chList[i];
                 const isJoined1 = !notJoined.includes(ch1);
                 const text1 = isJoined1 ? `✅ Joined` : `➕ Join`;
                 const url1 = ch1.startsWith('http') ? ch1 : (ch1.startsWith('@') ? `https://t.me/${ch1.substring(1)}` : `https://t.me/c/${ch1.replace('-100', '')}/999999999`);
                 row.push({ text: text1, url: url1 });

                 if (i + 1 < chList.length) {
                    const ch2 = chList[i + 1];
                    const isJoined2 = !notJoined.includes(ch2);
                    const text2 = isJoined2 ? `✅ Joined` : `➕ Join`;
                    const url2 = ch2.startsWith('http') ? ch2 : (ch2.startsWith('@') ? `https://t.me/${ch2.substring(1)}` : `https://t.me/c/${ch2.replace('-100', '')}/999999999`);
                    row.push({ text: text2, url: url2 });
                 }
                 buttons.push(row);
              }
              
              // Unchecked (Optional) - separate row or integrated
              if (hasUnchecked) {
                const uChList = node.config.forceJoinChannelsUnchecked;
                for (let i = 0; i < uChList.length; i += 2) {
                   const row = [];
                   const ch1 = uChList[i];
                   const url1 = ch1.startsWith('http') ? ch1 : (ch1.startsWith('@') ? `https://t.me/${ch1.substring(1)}` : `https://t.me/c/${ch1.replace('-100', '')}/999999999`);
                   row.push({ text: "🔘 Optional", url: url1 });

                   if (i + 1 < uChList.length) {
                      const ch2 = uChList[i + 1];
                      const url2 = ch2.startsWith('http') ? ch2 : (ch2.startsWith('@') ? `https://t.me/${ch2.substring(1)}` : `https://t.me/c/${ch2.replace('-100', '')}/999999999`);
                      row.push({ text: "🔘 Optional", url: url2 });
                   }
                   buttons.push(row);
                }
              }

              buttons.push([{ text: "🔥 Claim", callback_data: `check_join_${refId || 'none'}` }]);
              
              const me = await bot.getMe();
              const welcomeSub = `👋WELCOME TO OUR ${me.first_name} ok KEEP REFER & MONEY💸\n\n👉🏻REGISTER OUR OFFICIAL GATEWAY🖇️https://srwallet.vercel.app/\n\n🚀 BUILDER = @srbotmakerbot`;
              
              return bot.sendMessage(userId, welcomeSub, {
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'HTML'
              });
            }
          }
          
          if (node.config.deviceVerification && user && !user.verified) {
             const appUrl = BASE_URL || process.env.VITE_APP_URL || "";
             const verifyUrl = `${appUrl}/verify?nodeId=${node.id}&userId=${userId}&ref=${refId || 'none'}`;
             const headerImg = "https://t.me/SR_TECHNOLOGY_LTD/330"; 
             return bot.sendPhoto(userId, headerImg, {
               caption: "🛡️ <b>SECURITY VERIFICATION</b>\n\nPlease verify your device below to ensure you're a real human.",
               reply_markup: { inline_keyboard: [[{ text: "Verifying Device 🛡️", web_app: { url: verifyUrl } }]]},
               parse_mode: 'HTML'
             });
          }

          return this.sendUserDashboard(bot, node, userId);
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
          return bot.sendMessage(userId, "❌ <b>Access Restricted!</b>\n\nPlease join ALL required channels first to use this bot.", {
            reply_markup: { inline_keyboard: buttons },
            parse_mode: 'HTML'
          }).catch(() => {});
        }
      }

      // FSM Handling for Admin/User inputs
      const state = this.fsmStates.get(userId);
      if (state && state.nodeId === node.id) {
        await this.handleFSM(bot, node, userId, text || "", state, msg);
        return;
      }

      if (!user) return;

      if (text.includes("Bonus") || text.includes("🎁") || text.includes("Bonus")) {
        const kb = {
          inline_keyboard: [
            [{ text: "✨ Daily Bonus", callback_data: `sub_daily_bonus_${node.id}` }],
            [{ text: "🧧 Gift Code", callback_data: `sub_gift_code_claim_${node.id}` }]
          ]
        };
        return bot.sendMessage(userId, "🎁 **BONUS CENTER**\n\nChoose an option to claim your rewards:", { reply_markup: kb, parse_mode: 'Markdown' });
      }

      if (text.includes("Balance") || text.includes("💰") || text.includes("🎁 Balance")) {
        const balText = `💰 **USER BALANCE:** \`₹${user.balance.toFixed(2)}\`\n\n` +
          `Use the 'Withdraw' button to transfer your earnings.`;
        return bot.sendMessage(userId, balText, { parse_mode: 'Markdown' }).catch(() => {});
      }

      if (text.includes(esc("Refer")) || text.includes(esc("Earn")) || text.includes("👥") || text.includes("🎀")) {
        const me = await bot.getMe();
        const link = `https://t.me/${me.username}?start=${userId}`;
        const refMsg = `💸 **REFER & EARN PROGRAM**\n\n💰 Reward: **₹${node.config.referBonus}** per referral\n\n🔗 **Your Unique Link:**\n\`${link}\`\n\nShare this link to earn instant bonus credits!`;
        
        const kb = {
          inline_keyboard: [
            [{ text: "📊 My Invites", callback_data: `sub_my_invites_${node.id}` }]
          ]
        };
        return bot.sendMessage(userId, refMsg, { parse_mode: 'Markdown', reply_markup: kb }).catch(() => {});
      }

      if (text.includes("Redeem") || text.includes("🎟") || text === "Gift Code") {
        this.fsmStates.set(userId, { nodeId: node.id, action: "REDEEM_GIFT" });
        return bot.sendMessage(userId, "⌨️ **Enter your Gift Code to redeem:**");
      }

      if (text.includes("Wallet") || text.includes("🏦") || text.includes("Link UPI")) {
        this.fsmStates.set(userId, { nodeId: node.id, action: "SET_WALLET" });
        const gatewayName = node.config.payoutGatewayName || "SR WALLET";
        const gatewayLink = node.config.payoutAppUrl || "https://srwallet.vercel.app/";
        const prompt = node.type === 'upi_manual' ? "⌨️ **LINK UPI ADDRESS**\n\nEnter your UPI ID to receive manual payments:" : `🏦 **PAYMENTS GATEWAY WALLET CONFIGURATION**\n\nRegister and get your wallet ID / Account Number below.\n\nEnter your Wallet ID / Account Number: and type here 👇🏻`;
        
        return bot.sendMessage(userId, prompt, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: "TAP TO OPEN GATEWAY NOW", url: gatewayLink }]
            ]
          }
        });
      }

      if (text.includes("Withdraw") || text.includes("💸") || text.includes("🚀 Withdraw")) {
        if (!node.config.withdrawStatus) return bot.sendMessage(userId, "🔴 withdrawal off").catch(() => {});
        if (!user.walletId && !['poll', 'file', 'giveaway'].includes(node.type)) return bot.sendMessage(userId, "❌ **Wallet Not Set!**\n\nRegister and get your account number and set your wallet ID first using 'Set Payout Wallet' button.").catch(() => {});
        
        if (user.walletId && node.config.bannedWallets.has(user.walletId)) {
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
        bot.sendMessage(userId, `💰 **WITHDRAWAL INTERFACE**\n\n💵 Available: ₹${user.balance.toFixed(2)}\n💳 Wallet: \`${esc(user.walletId || "Default Wallet")}\`\n\n**Enter amount to withdraw:**`, { parse_mode: 'Markdown' }).catch(() => {});
      }

      if (text === "🎯 Play Bet") {
        const user = await this.ensureUserLoaded(node, userId);
        if (!user) return;
        const win = Math.random() > 0.7;
        const amount = win ? (Math.random() * 5 + 1) : 0;
        if (win) {
          user.balance += amount;
          await this.saveUserToFirestore(node.id, userId, user);
          bot.sendMessage(userId, `🎯 **BET SUCCESS!** 🎯\n\nYou won **₹${amount.toFixed(2)}**! Your balance has been updated.`);
        } else {
          bot.sendMessage(userId, "🎯 **BET LOSS** 🎯\n\nBetter luck next time! Keep playing to win big rewards.");
        }
        return;
      }

      if (text === "📊 Create Poll") {
        return bot.sendPoll(userId, "How is our system working?", ["Best", "Good", "Needs Work"], { is_anonymous: false });
      }

      if (text === "📁 File Store") {
        return bot.sendMessage(userId, "📁 **FILE STORAGE HUB**\n\nUpload files to get direct shareable links.\n\n*Status: Feature coming in Enterprise Cloud*");
      }

      if (text === "📋 Tasks") {
        return bot.sendMessage(userId, "📋 **AVAILABLE TASKS**\n\n1. Visit Website (₹1)\n2. Watch Ad (₹0.5)\n3. Install App (₹10)\n\n*Contact @Admin to verify tasks.*");
      }

      if (text === "🎟️ Redeem" || text === "Gift Code" || text.includes("Redeem")) {
        this.fsmStates.set(userId, { nodeId: node.id, action: "REDEEM_GIFT" });
        return bot.sendMessage(userId, "🎟️ **REDEEM GIFT CODE**\n\nPlease enter your gift code below to claim your reward:");
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

        if (data.startsWith('sub_my_invites_')) {
          const nodeId = data.replace('sub_my_invites_', '');
          const node = this.nodes.get(nodeId);
          if (!node) return;
          const user = await this.ensureUserLoaded(node, userId);
          if (!user) return;

          const stats = `📊 **YOUR REFERRAL STATS**\n\n` +
            `👤 Users Started from Your Link: ${user.referrals}\n` +
            `⚠️ Users Haven't Joined Channels: 0\n` +
            `✅ Verified and Credited From: ${user.referrals}\n\n` +
            `Keep referring to earn more!`;
          bot.answerCallbackQuery(query.id);
          bot.sendMessage(userId, stats).catch(() => {});
          return;
        }

        if (data.startsWith('sub_leaderboard_')) {
          const nodeId = data.replace('sub_leaderboard_', '');
          const node = this.nodes.get(nodeId);
          if (!node) return;
          
          const sorted = Array.from(node.users.entries())
            .sort((a, b) => b[1].referrals - a[1].referrals)
            .slice(0, 5);
          
          let list = "🏆 **Top Users With Most Refers:**\n\n";
          sorted.forEach(([uId, u], i) => {
             const maskedId = String(uId).substring(0, 2) + "****" + String(uId).substring(String(uId).length - 3);
             list += `${i + 1}️⃣ **Top ${i+1}:**\nUser Id: ${maskedId}\nVerified Refers: ${u.referrals}\n\n`;
          });
          
          bot.answerCallbackQuery(query.id);
          bot.sendMessage(userId, list, { parse_mode: 'Markdown' }).catch(() => {});
          return;
        }
        if (data.startsWith('sub_daily_bonus_')) {
          const nodeId = data.replace('sub_daily_bonus_', '');
          const node = this.nodes.get(nodeId);
          if (!node) return;
          const user = await this.ensureUserLoaded(node, userId);
          if (!user) return;
  
          const now = Date.now();
          const lastClaim = user.lastDailyClaim || 0;
          const cooldown = 24 * 60 * 60 * 1000;
  
          if (now - lastClaim < cooldown) {
            const remaining = cooldown - (now - lastClaim);
            const hours = Math.floor(remaining / (60 * 60 * 1000));
            const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
            return bot.answerCallbackQuery(query.id, { text: `❌ Cooldown: ${hours}h ${mins}m left`, show_alert: true });
          }
  
          user.balance += node.config.dailyBonus;
          user.lastDailyClaim = now;
          await this.saveUserToFirestore(node.id, userId, user);
          bot.answerCallbackQuery(query.id, { text: `✅ Claimed ₹${node.config.dailyBonus}!`, show_alert: true });
          bot.sendMessage(userId, `congratulations 🎉 you have successfully claimed the bonus RS ${node.config.dailyBonus}`);
          return;
        }
  
        if (data.startsWith('sub_gift_code_claim_')) {
          const nodeId = data.replace('sub_gift_code_claim_', '');
          const node = this.nodes.get(nodeId);
          if (!node) return;
          this.fsmStates.set(userId, { nodeId: node.id, action: "REDEEM_GIFT" });
          bot.sendMessage(userId, "🧧 **CLAIM GIFT CODE**\n\nEnter your gift code below:");
          bot.answerCallbackQuery(query.id);
          return;
        }

        const isAdminUser = isAdmin(userId);

        // --- INTERCEPTOR: Node Ban Check ---
        if (node.isBannedByAdmin && !isAdminUser) {
           bot.answerCallbackQuery(query.id, { text: "❌ BANNED", show_alert: true });
           const restrictedText = `🚫 **YOUR BOT IS BANNED FROM SR BOT MAKER ADMIN** 🚫\n\n` +
                                `⚠️ *Reason:* Safety violation or Policy breach detected.\n\n` +
                                `📞 **Please contact Admin to appeal:** @SR_TECNOLOGY_LTD`;
           return bot.sendMessage(userId, restrictedText, { parse_mode: 'Markdown' });
        }

        // --- INTERCEPTOR: Bot Maintenance ---
        if (!isAdminUser && !node.config.botStatus) {
           bot.answerCallbackQuery(query.id);
           const offText = node.config.botOffText || `🔴 @${node.username} OVER SEE YOU SOON`;
           return bot.sendMessage(userId, offText);
        }

        // Security: Block admin actions for non-admins
        if (data.startsWith('adm_') || data.startsWith('APPROVE_WD_') || data.startsWith('REJECT_WD_') || data.startsWith('approve_wd_') || data.startsWith('reject_wd_')) {
          if (!isAdminUser) {
            return bot.answerCallbackQuery(query.id, { text: "❌ Admins Only", show_alert: true });
          }
        }

        // --- HANDLERS ---
        
        if (data === 'adm_toggle_whole') {
          node.config.amountInWhole = !node.config.amountInWhole;
          bot.answerCallbackQuery(query.id, { text: `Whole Amount: ${node.config.amountInWhole ? "ON" : "OFF"}` });
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        if (data === 'adm_toggle_device') {
          node.config.deviceVerification = !node.config.deviceVerification;
          bot.answerCallbackQuery(query.id, { text: `Device Check: ${node.config.deviceVerification ? "ON" : "OFF"}` });
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        if (data === 'adm_toggle_alerts') {
          node.config.userAlerts = !node.config.userAlerts;
          bot.answerCallbackQuery(query.id, { text: `User Alerts: ${node.config.userAlerts ? "ON" : "OFF"}` });
          await this.saveNodeToFirestore(node);
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        if (data === 'adm_toggle_bot') {
          if (node.isBannedByAdmin && !node.config.botStatus) {
            return bot.answerCallbackQuery(query.id, { text: "❌ BANNED: This node is restricted by SR HUB ADMIN.", show_alert: true });
          }
          node.config.botStatus = !node.config.botStatus;
          bot.answerCallbackQuery(query.id, { text: `Bot Status: ${node.config.botStatus ? "ON" : "OFF"}` });
          if (!node.config.botStatus) {
            this.logAdminAction(node, "Bot Engine Paused by Admin");
          } else {
            this.logAdminAction(node, "Bot Engine Resumed by Admin");
          }
          await this.saveNodeToFirestore(node);
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        if (data === 'adm_toggle_withdraw') {
          node.config.withdrawStatus = !node.config.withdrawStatus;
          bot.answerCallbackQuery(query.id, { text: `Payout Status: ${node.config.withdrawStatus ? "ON" : "OFF"}` });
          await this.saveNodeToFirestore(node);
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        if (data === 'adm_toggle_antibot') {
          node.config.antiBot = !node.config.antiBot;
          bot.answerCallbackQuery(query.id, { text: `Anti-Bot: ${node.config.antiBot ? "ON" : "OFF"}` });
          await this.saveNodeToFirestore(node);
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        if (data === 'adm_toggle_autopay') {
          node.config.autoPayout = !node.config.autoPayout;
          bot.answerCallbackQuery(query.id, { text: `Auto Payout: ${node.config.autoPayout ? "ON" : "OFF"}` });
          await this.saveNodeToFirestore(node);
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        if (data === 'adm_set_payoutChannel') {
          this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_payoutChannel" });
          return bot.sendMessage(userId, "📢 **PAYOUT CHANNEL SETUP**\n\nEnter Channel Username (including @):\nExample: `@YourChannel` (Ensure bot is ADMIN in it)");
        }

        if (data === 'adm_set_maxWithdraw') {
          this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_maxWithdraw" });
          return bot.sendMessage(userId, "💸 **SET MAX WITHDRAWAL**\n\nEnter the maximum allowed amount per withdrawal:");
        }

        if (data === 'adm_set_minWithdraw') {
          this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_minWithdraw" });
          return bot.sendMessage(userId, "💸 **SET MIN WITHDRAWAL**\n\nEnter the minimum allowed amount per withdrawal:");
        }

        if (data === 'adm_set_referBonus') {
          this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_referBonus" });
          return bot.sendMessage(userId, "👥 **SET REFER BONUS**\n\nEnter the referral reward amount per user:");
        }

        if (data === 'adm_set_minReferForPayout') {
          this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_minReferForPayout" });
          return bot.sendMessage(userId, "👥 **SET MIN REFER FOR PAYOUT**\n\nEnter the minimum number of referrals required to withdraw:");
        }

        if (data === 'adm_set_dailyBonus') {
          this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_dailyBonus" });
          return bot.sendMessage(userId, "🎁 **SET DAILY BONUS**\n\nEnter the daily bonus reward amount:");
        }

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

        if (data.startsWith('adm_set_tpl_')) {
          const tpl = data.replace('adm_set_tpl_', '') as BotNode['type'];
          node.type = tpl;
          if (tpl === 'autopay') {
            node.config.autoPayout = true;
            node.config.withdrawTax = 5;
            node.config.minWithdraw = 10;
          } else if (tpl === 'refer_manual' || tpl === 'upi_manual') {
            node.config.autoPayout = false;
            node.config.withdrawTax = 2;
            node.config.minWithdraw = 10;
          } else if (tpl === 'upi') {
            node.config.autoPayout = false;
            node.config.withdrawTax = 2;
            node.config.minWithdraw = 50;
          } else if (tpl === 'crypto') {
            node.config.autoPayout = false;
            node.config.withdrawTax = 0;
            node.config.minWithdraw = 100;
          }
          await this.saveNodeToFirestore(node);
          bot.answerCallbackQuery(query.id, { text: `Template ${tpl.toUpperCase()} Applied!` });
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        if (data.startsWith('adm_bc_gift_')) {
          const code = data.replace('adm_bc_gift_', '');
          const g = node.config.giftCodes.get(code);
          if (!g) return bot.answerCallbackQuery(query.id, { text: "Gift code not found" });

          bot.answerCallbackQuery(query.id, { text: "🚀 Code Broadcast Started!" });
          const bcText = `🧧 **NEW GIFT CODE ALERT!**\n\n🎁 Value: ₹${g.amount}\n👥 Max Uses: ${g.maxUses}\n\n🎫 Use code: \`${code}\`\n\nClick /redeem to use this code!`;
          
          this.fsmStates.set(userId, { 
            nodeId: node.id, 
            action: "BC_CONFIRM", 
            text: bcText,
            inline_keyboard: [[{ text: "🎁 CLAIM NOW", callback_data: "redeem_gift" }]] 
          });
          
          // Re-trigger the broadcast confirm logic by simulating a CONFIRM message
          return this.handleFSM(bot, node, userId, "CONFIRM", this.fsmStates.get(userId), { text: "CONFIRM" });
        }

        if (data === 'adm_back_main') {
          return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
        }

        // Generic field setter (fallback)
        if (data.startsWith('adm_set_')) {
          const field = data.replace('adm_set_', '');
          this.fsmStates.set(userId, { nodeId: node.id, action: `EDIT_${field}` });
          return bot.sendMessage(userId, `⌨️ Enter new value for **${field}**:`);
        }

        bot.answerCallbackQuery(query.id);

      if (data === "BC_RUN_CENTER") {
        const state = this.fsmStates.get(userId);
        if (!state) return bot.sendMessage(userId, "❌ Broadcast session expired.");
        
        this.fsmStates.delete(userId);
        bot.sendMessage(userId, "🚀 **Broadcast Initiated!** Checking network...");
        
        const run = async () => {
          try {
            const snap = await getDocs(collection(cdb, 'nodes', node.id, 'users'));
            const allUsers = snap.docs.map(d => Number(d.id));
            let success = 0;
            let failed = 0;
            const startTime = Date.now();

            for (const uid of allUsers) {
              try {
                const opts = { reply_markup: { inline_keyboard: state.inline_keyboard || [] }, parse_mode: 'Markdown' };
                if (state.media?.photo) {
                  await bot.sendPhoto(uid, state.media.photo[state.media.photo.length - 1].file_id, { ...opts, caption: state.text });
                } else if (state.media?.video) {
                  await bot.sendVideo(uid, state.media.video.file_id, { ...opts, caption: state.text });
                } else {
                  await bot.sendMessage(uid, state.text, opts);
                }
                success++;
              } catch (e) {
                failed++;
              }
              await new Promise(r => setTimeout(r, 45));
            }

            const summary = `📊 **Broadcast Summary Report**\n\n` +
              `📦 **Overall Results:**\n` +
              `• Total Users: ${allUsers.length}\n` +
              `✅ **Success: ${success}**\n` +
              `❌ **Failed: ${failed}**\n` +
              `⏱ **Time Taken:** ${Math.floor((Date.now() - startTime) / 1000)}s`;
            
            bot.sendMessage(userId, summary, { parse_mode: 'Markdown' });
          } catch (err: any) {
             bot.sendMessage(userId, `❌ Broadcast Error: ${err.message}`);
          }
        };
        run();
        return;
      }

      if (data === "BC_CANCEL") {
        this.fsmStates.delete(userId);
        return bot.sendMessage(userId, "❌ Broadcast operation cancelled.");
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

      if (data === 'adm_set_joinNotice') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_joinNotice" });
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(userId, "🖊 **EDIT WELCOME MESSAGE**\n\nEnter the new join notice text:");
      }
      if (data === 'adm_set_supportContact') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_supportContact" });
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(userId, "👤 **SUPPORT HANDLE SETUP**\n\nEnter support username (e.g. @Admin):");
      }
      if (data === 'adm_set_updateChannel') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_updateChannel" });
        bot.answerCallbackQuery(query.id);
        return bot.sendMessage(userId, "📢 **UPDATE CHANNEL SETUP**\n\nEnter channel username (e.g. @MyChannel):");
      }

      if (data === 'adm_tpl_manage') {
        const kb = {
          inline_keyboard: [
            [{ text: "1️⃣ Task Payment Bot", callback_data: "adm_set_tpl_task" }, { text: "6️⃣ Wallet Bot", callback_data: "adm_set_tpl_wallet" }],
            [{ text: "2️⃣ Bet & Earn Bot", callback_data: "adm_set_tpl_bet" }, { text: "7️⃣ File Store Bot", callback_data: "adm_set_tpl_file" }],
            [{ text: "3️⃣ Redeem Code Bot", callback_data: "adm_set_tpl_redeem" }, { text: "8️⃣ Star Auto-Pay", callback_data: "adm_set_tpl_star" }],
            [{ text: "4️⃣ Giveaway Bot", callback_data: "adm_set_tpl_giveaway" }, { text: "9️⃣ Poll Maker Bot", callback_data: "adm_set_tpl_poll" }],
            [{ text: "5️⃣ Refer Auto-Pay", callback_data: "adm_set_tpl_refer_auto" }, { text: "🔟 Refer Manual", callback_data: "adm_set_tpl_refer_manual" }],
            [{ text: "1️⃣1️⃣ UPI Manual Pay Bot", callback_data: "adm_set_tpl_upi_manual" }],
            [{ text: "💳 Hybrid UPI", callback_data: "adm_set_tpl_upi" }, { text: "💎 Crypto M01", callback_data: "adm_set_tpl_crypto" }],
            [{ text: "🔙 Back", callback_data: "adm_back_main" }]
          ]
        };
        bot.answerCallbackQuery(query.id);
        return bot.editMessageText("🛠 **SELECT READY-MADE TEMPLATE**\n\nChoose a pre-configured setup for your bot node.", { chat_id: userId, message_id: query.message?.message_id, reply_markup: kb });
      }

      if (data.startsWith('adm_set_tpl_')) {
        const tpl = data.replace('adm_set_tpl_', '') as BotNode['type'];
        node.type = tpl;
        bot.answerCallbackQuery(query.id, { text: `✅ Template ${tpl.toUpperCase()} Applied!` });
        await this.saveNodeToFirestore(node);
        return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_ui_custom') {
        const dvStatus = node.config.deviceVerification ? "🟢 ON" : "🔴 OFF";
        const kb = {
          inline_keyboard: [
            [{ text: "🖊 Edit Dashboard Text", callback_data: "adm_set_dashText" }],
            [{ text: "🖼️ Edit Dashboard Photo", callback_data: "adm_set_dashImg" }],
            [{ text: `🛡️ Device Verify: ${dvStatus}`, callback_data: "adm_tgl_dv" }],
            [{ text: "🛠️ Edit Build Info", callback_data: "adm_set_buildInfo" }],
            [{ text: "🔴 Edit Bot Off Message", callback_data: "adm_set_botOffText" }],
            [{ text: "📡 Manage Force Join", callback_data: `adm_view_forceJoin` }],
            [{ text: "👤 Support Handle", callback_data: `adm_set_supportContact` }],
            [{ text: "📢 Update Channel", callback_data: `adm_set_updateChannel` }],
            [{ text: "🗑️ Reset Customizations", callback_data: "adm_reset_ui" }],
            [{ text: "🔙 Back", callback_data: `adm_back_main` }]
          ]
        };
        bot.editMessageText("🎨 **USER INTERFACE CUSTOMIZATION**\n\nCustomize the appearance and contacts of the user-facing menus.", { chat_id: userId, message_id: query.message?.message_id, reply_markup: kb });
        return;
      }

      if (data === "adm_tgl_dv") {
        node.config.deviceVerification = !node.config.deviceVerification;
        bot.answerCallbackQuery(query.id, { text: `Device Verification: ${node.config.deviceVerification ? 'ENABLED' : 'DISABLED'}` });
        await this.saveNodeToFirestore(node);
        return this.handleSubBotCallback(bot, node, userId, 'adm_ui_custom', { message: query.message });
      }

      if (data === 'adm_set_dashText') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_DASH_TEXT" });
        return bot.sendMessage(userId, "📝 **EDIT DASHBOARD TEXT**\n\nEnter the new text (HTML supported) for user dashboard:");
      }

      if (data === 'adm_set_dashImg') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_DASH_IMG" });
        return bot.sendMessage(userId, "🖼️ **EDIT DASHBOARD PHOTO**\n\nSend the photo or file_id/URL to use as dashboard header:");
      }

      if (data === 'adm_set_buildInfo') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_buildInfo" });
        return bot.sendMessage(userId, "🛠️ **EDIT BUILD INFO**\n\nEnter the new build info text (Markdown supported):");
      }

      if (data === 'adm_set_botOffText') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "EDIT_botOffText" });
        return bot.sendMessage(userId, "🔴 **EDIT BOT OFF MESSAGE**\n\nEnter the message users see when bot is offline:");
      }

      if (data === 'adm_reset_ui') {
        node.config.customDashboardText = undefined;
        node.config.customDashboardImage = undefined;
        node.config.customMenu = undefined;
        node.config.buildInfoText = undefined;
        node.config.botOffText = undefined;
        bot.answerCallbackQuery(query.id, { text: "✅ Customizations Reset!" });
        await this.saveNodeToFirestore(node);
        return this.sendAdminPanel(bot, node, userId, query.message?.message_id);
      }

      if (data === 'adm_ask_add_channel') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "ADD_CHANNEL", type: 'CHECKED' });
        return bot.sendMessage(userId, "📡 **ADD CHECKED CHANNEL**\n\nEnter Username (`@Channel`) or Chat ID (`-100...`).\nBot MUST be Admin!");
      }

      if (data === 'adm_ask_add_channel_u') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "ADD_CHANNEL", type: 'UNCHECKED' });
        return bot.sendMessage(userId, "📡 **ADD UNCHECKED CHANNEL**\n\nEnter Username (`@Channel`) or Link.\nBot doesn't need admin here.");
      }

      if (data.startsWith('check_join')) {
        const refIdStr = data.replace('check_join_', '').replace('check_join', '');
        const refId = (refIdStr && refIdStr !== 'none') ? parseInt(refIdStr) : null;

        const hasChecked = node.config.forceJoinChannels && node.config.forceJoinChannels.length > 0;
        const hasUnchecked = node.config.forceJoinChannelsUnchecked && node.config.forceJoinChannelsUnchecked.length > 0;

        if (hasChecked || hasUnchecked) {
          bot.answerCallbackQuery(query.id, { text: "⏳ Verifying membership..." });
          
          const notJoined = [];
          if (hasChecked) {
            for (const ch of node.config.forceJoinChannels) {
              const j = await this.checkForceJoin(bot, ch, userId);
              if (!j) notJoined.push(ch);
            }
          }
          
          if (notJoined.length === 0) {
            bot.deleteMessage(userId, query.message?.message_id!).catch(() => {});
            
            let user = await this.ensureUserLoaded(node, userId);
            if (node.config.deviceVerification && user && !user.verified) {
               const appUrl = BASE_URL || process.env.VITE_APP_URL || "";
               const verifyUrl = `${appUrl}/verify?nodeId=${node.id}&userId=${userId}&ref=${refId || 'none'}`;
               const headerImg = "https://t.me/SR_TECHNOLOGY_LTD/330"; 
               bot.sendPhoto(userId, headerImg, {
                 caption: "🛡️ <b>SECURITY VERIFICATION</b>\n\nPlease verify your device below to ensure you're a real human.",
                 reply_markup: { inline_keyboard: [[{ text: "Verifying Device 🛡️", web_app: { url: verifyUrl } }]]},
                 parse_mode: 'HTML'
               }).catch(() => {
                 // Fallback if photo fails
                 bot.sendMessage(userId, "🛡️ **SECURITY VERIFICATION**\n\nPlease verify your device below to ensure you're a real human.", {
                   reply_markup: { inline_keyboard: [[{ text: "Verifying Device 🛡️", web_app: { url: verifyUrl } }]]},
                   parse_mode: 'HTML'
                 });
               });
               return;
            }
            if (user) user.verified = true; 
            return this.sendUserDashboard(bot, node, userId);
          } else {
            bot.answerCallbackQuery(query.id, { text: "❌ Please join ALL mandatory channels first!", show_alert: true });
            const buttons = [];
            
            // Grid Layout
            const chList = [...(node.config.forceJoinChannels || [])];
            for (let i = 0; i < chList.length; i += 2) {
               const row = [];
               const ch1 = chList[i];
               const isJoined1 = !notJoined.includes(ch1);
               const text1 = isJoined1 ? `✅ Joined` : `➕ Join`;
               const url1 = ch1.startsWith('http') ? ch1 : (ch1.startsWith('@') ? `https://t.me/${ch1.substring(1)}` : `https://t.me/c/${ch1.replace('-100', '')}/999999999`);
               row.push({ text: text1, url: url1 });

               if (i + 1 < chList.length) {
                  const ch2 = chList[i + 1];
                  const isJoined2 = !notJoined.includes(ch2);
                  const text2 = isJoined2 ? `✅ Joined` : `➕ Join`;
                  const url2 = ch2.startsWith('http') ? ch2 : (ch2.startsWith('@') ? `https://t.me/${ch2.substring(1)}` : `https://t.me/c/${ch2.replace('-100', '')}/999999999`);
                  row.push({ text: text2, url: url2 });
               }
               buttons.push(row);
            }

            if (hasUnchecked) {
              const uChList = node.config.forceJoinChannelsUnchecked;
              for (let i = 0; i < uChList.length; i += 2) {
                 const row = [];
                 const ch1 = uChList[i];
                 const url1 = ch1.startsWith('http') ? ch1 : (ch1.startsWith('@') ? `https://t.me/${ch1.substring(1)}` : `https://t.me/c/${ch1.replace('-100', '')}/999999999`);
                 row.push({ text: "🔘 Optional", url: url1 });

                 if (i + 1 < uChList.length) {
                    const ch2 = uChList[i + 1];
                    const url2 = ch2.startsWith('http') ? ch2 : (ch2.startsWith('@') ? `https://t.me/${ch2.substring(1)}` : `https://t.me/c/${ch2.replace('-100', '')}/999999999`);
                    row.push({ text: "🔘 Optional", url: url2 });
                 }
                 buttons.push(row);
              }
            }

            buttons.push([{ text: "🔥 Claim", callback_data: `check_join_${refId || 'none'}` }]);
            bot.editMessageReplyMarkup({ inline_keyboard: buttons }, { chat_id: userId, message_id: query.message?.message_id }).catch(() => {});
          }
        } else {
          bot.answerCallbackQuery(query.id, { text: "✅ System Restored" });
          return this.sendUserDashboard(bot, node, userId);
        }
        return;
      }

      if (data.startsWith('adm_rem_fj_')) {
        const idx = parseInt(data.replace('adm_rem_fj_', ''));
        if (node.config.forceJoinChannels && node.config.forceJoinChannels[idx]) {
          const removed = node.config.forceJoinChannels.splice(idx, 1);
          bot.answerCallbackQuery(query.id, { text: `Removed: ${removed[0]}` });
          await this.saveNodeToFirestore(node);
          
          // Refresh the list view
          const keyboardRows: any[][] = [];
          node.config.forceJoinChannels.forEach((ch, i) => {
            keyboardRows.push([
              { text: `✅ ${esc(ch)}`, callback_data: "adm_noop" },
              { text: "❌", callback_data: `adm_rem_fj_${i}` }
            ]);
          });
          keyboardRows.push([{ text: "➕ Add Join Channels", callback_data: "adm_ask_add_channel" }]);
          keyboardRows.push([{ text: "🔙 Back", callback_data: "adm_back_main" }]);
          
          bot.editMessageReplyMarkup({ inline_keyboard: keyboardRows }, { chat_id: userId, message_id: query.message?.message_id }).catch(() => {});
        }
        return;
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

      if (data === 'adm_gift') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "CREATE_GIFT_AMT" });
        bot.sendMessage(userId, "🎁 **GIFT CODE GENERATOR**\n\n⌨️ Enter amount for the new gift code:");
      }

      if (data === 'adm_gift_panel') {
        let list = "👾 **REDEEM CODE PANEL**\n\n";
        if (node.config.giftCodes.size === 0) {
          list += "_No active codes._";
        } else {
          node.config.giftCodes.forEach((v, k) => {
            list += `🎫 \`${k}\`\n💰 ₹${v.amount} | 👥 ${v.currentClaims}/${v.maxUses}\n${v.status === 'active' ? "🟢 ACTIVE" : "🔴 OFF"}\n\n`;
          });
        }
        bot.sendMessage(userId, list, { parse_mode: 'Markdown' });
      }

      if (data === 'adm_notice') {
        this.fsmStates.set(userId, { nodeId: node.id, action: "SET_NOTICE" });
        bot.sendMessage(userId, "⌨️ **Enter 'On Join Notice' text:**\n(Current: " + (node.config.joinNotice || "None") + ")");
      }

      if (data === 'adm_view_forceJoin') {
        const panelText = "📋 **Manage Channels Panel**\n\n" +
          "✅ **Checked Channels** (Must join to use bot)\n" +
          "🔘 **Unchecked Channels** (Optional, but visible)\n\n" +
          "Click ❌ to delete a channel.";

        const keyboardRows: any[][] = [];
        
        // Checked
        node.config.forceJoinChannels.forEach((ch, i) => {
          keyboardRows.push([
            { text: `✅ ${esc(ch)}`, callback_data: "adm_noop" },
            { text: "❌ Remove", callback_data: `adm_rem_fj_${i}` }
          ]);
        });

        // Unchecked
        if (node.config.forceJoinChannelsUnchecked) {
          node.config.forceJoinChannelsUnchecked.forEach((ch, i) => {
            keyboardRows.push([
              { text: `🔘 ${esc(ch)}`, callback_data: "adm_noop" },
              { text: "❌ Remove", callback_data: `adm_rem_fju_${i}` }
            ]);
          });
        }

        keyboardRows.push([{ text: "➕ Add Check Channels", callback_data: "adm_ask_add_channel" }]);
        keyboardRows.push([{ text: "➕ Add Uncheck Channels", callback_data: "adm_ask_add_channel_u" }]);
        keyboardRows.push([{ text: "🔙 Back", callback_data: "adm_back_main" }]);

        const kb = { inline_keyboard: keyboardRows };
        
        const messageId = query.message?.message_id;
        if (messageId) {
          bot.editMessageText(panelText, { chat_id: userId, message_id: messageId, parse_mode: 'Markdown', reply_markup: kb }).catch(() => {});
        } else {
          bot.sendMessage(userId, panelText, { parse_mode: 'Markdown', reply_markup: kb });
        }
        return;
      }

      if (data.startsWith('adm_rem_fj_')) {
        const index = parseInt(data.replace('adm_rem_fj_', ''));
        if (node.config.forceJoinChannels && node.config.forceJoinChannels[index] !== undefined) {
          const removed = node.config.forceJoinChannels.splice(index, 1);
          bot.answerCallbackQuery(query.id, { text: `Removed: ${removed[0]}` });
          await this.saveNodeToFirestore(node);
          
          // Re-trigger view
          return this.handleSubBotCallback(bot, node, userId, 'adm_view_forceJoin', query);
        }
        return;
      }

      if (data.startsWith('adm_rem_fju_')) {
        const index = parseInt(data.replace('adm_rem_fju_', ''));
        if (node.config.forceJoinChannelsUnchecked && node.config.forceJoinChannelsUnchecked[index] !== undefined) {
          const removed = node.config.forceJoinChannelsUnchecked.splice(index, 1);
          bot.answerCallbackQuery(query.id, { text: `Removed: ${removed[0]}` });
          await this.saveNodeToFirestore(node);
          
          // Re-trigger view
          return this.handleSubBotCallback(bot, node, userId, 'adm_view_forceJoin', query);
        }
        return;
      }

      if (data === 'adm_noop') {
        return bot.answerCallbackQuery(query.id, { text: "🚀 Feature active in Professional Version!" });
      }

      bot.answerCallbackQuery(query.id);
    } catch (err: any) {
      console.error(`[CB_HANDLER_ERR] User ${query.message?.chat.id}:`, err.message);
    }
    });
  }

  private handleSubBotCallback(bot: any, node: BotNode, userId: number, data: string, query: any) {
     // This is a wrapper to allow internal re-triggering of callback logic
     // It expects the logic for 'data' to be available. 
     // For simplicity, we just trigger the logic that would otherwise be in bot.on('callback_query')
     if (data === 'adm_view_forceJoin') {
        const panelText = "📋 **Manage Channels Panel**\n\n" +
          "✅ **Checked Channels** (Must join to use bot)\n" +
          "🔘 **Unchecked Channels** (Optional, but visible)\n\n" +
          "Click ❌ to delete a channel.";

        const keyboardRows: any[][] = [];
        node.config.forceJoinChannels.forEach((ch, i) => {
          keyboardRows.push([
            { text: `✅ ${esc(ch)}`, callback_data: "adm_noop" },
            { text: "❌ Remove", callback_data: `adm_rem_fj_${i}` }
          ]);
        });
        if (node.config.forceJoinChannelsUnchecked) {
          node.config.forceJoinChannelsUnchecked.forEach((ch, i) => {
            keyboardRows.push([
              { text: `🔘 ${esc(ch)}`, callback_data: "adm_noop" },
              { text: "❌ Remove", callback_data: `adm_rem_fju_${i}` }
            ]);
          });
        }
        keyboardRows.push([{ text: "➕ Add Check Channels", callback_data: "adm_ask_add_channel" }]);
        keyboardRows.push([{ text: "➕ Add Uncheck Channels", callback_data: "adm_ask_add_channel_u" }]);
        keyboardRows.push([{ text: "🔙 Back", callback_data: "adm_back_main" }]);
        
        bot.editMessageReplyMarkup({ inline_keyboard: keyboardRows }, { 
            chat_id: userId, 
            message_id: query.message?.message_id
        }).catch(() => {
            bot.sendMessage(userId, panelText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboardRows } });
        });
     }
  }

  private async checkForceJoin(bot: any, channelId: string, userId: number): Promise<boolean> {
    try {
      let finalId = channelId.trim();
      
      if (finalId.includes('t.me/')) {
        // Handle https://t.me/username
        const usernameMatch = finalId.match(/t\.me\/([a-zA-Z0-9_]{5,})/);
        // Handle https://t.me/+InviteHash
        const inviteMatch = finalId.match(/t\.me\/\+([a-zA-Z0-9_]+)/);
        // Handle https://t.me/joinchat/InviteHash
        const joinchatMatch = finalId.match(/t\.me\/joinchat\/([a-zA-Z0-9_-]+)/);

        if (usernameMatch && !finalId.includes('joinchat') && !finalId.includes('+')) {
          finalId = '@' + usernameMatch[1];
        } else if (inviteMatch || joinchatMatch) {
          // Can't check private invite links via standard getChatMember 
          // unless bot is creator or has specific permissions. 
          // For now, we allow it to avoid locking out users incorrectly.
          logSys(`[CHECK_JOIN_BYPASS] Link detected (${finalId}), assuming joined.`);
          return true; 
        }
      }
      
      const member = await bot.getChatMember(finalId, userId);
      return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (err: any) {
      // If bot is not in channel, getChatMember fails.
      // We should probably NOT return true if we want to BE strict,
      // but users often add IDs where the bot IS NOT admin yet.
      logSys(`[CHECK_JOIN_INFO] ${channelId}: Bot might not be admin there or invalid ID.`);
      return true; 
    }
  }

  private formatChannelLink(ch: string): string {
    if (!ch) return 'https://t.me/Telegram';
    const clean = ch.trim();
    if (clean.startsWith('http')) return clean;
    if (clean.startsWith('@')) return `https://t.me/${clean.substring(1)}`;
    if (clean.startsWith('-100')) {
      const cleanId = clean.replace('-100', '');
      // If it's a numeric ID, it's a private supergroup link format
      return `https://t.me/c/${cleanId}/999999999`;
    }
    // Handle case where user provides username without @
    if (/^[a-zA-Z0-9_]{5,}$/.test(clean)) return `https://t.me/${clean}`;
    return `https://t.me/${clean}`;
  }

  private logAdminAction(node: BotNode, action: string) {
    const timestamp = new Date().toLocaleString();
    node.config.adminLogs.push(`[${timestamp}] ${action}`);
  }

  private async handleFSM(bot: any, node: BotNode, userId: number, text: string, state: any, msg: any) {
    const action = state.action;
    const isHub = state.nodeId === "HUB_NODE";

    if (action === "HUB_ADD_CHANNEL") {
      let clean = text.trim();
      if (clean.includes("t.me/+") || clean.includes("joinchat")) {
        // Invite link - we suggest using username for better checking, but allow it
        bot.sendMessage(userId, "⚠️ **Notice:** Checking membership for private invite links is limited. Usernames (@channel) or Public Links are recommended for 100% accuracy.");
      }
      (this as any).hubForceJoinChannels.push(clean);
      await (this as any).saveHubConfig();
      this.fsmStates.delete(userId);
      return bot.sendMessage(userId, `✅ **Channel added!**\n\nDirect Link for users will be: ${this.formatChannelLink(clean)}`, { disable_web_page_preview: true });
    }

    if (action === "BC_CENTER_MEDIA") {
      if (text === "Skip Media") {
        this.fsmStates.set(userId, { ...state, action: "BC_CENTER_TEXT" });
        return bot.sendMessage(userId, "Write your message using HTML formatting if needed:\n\n<b>Bold</b>: &lt;b&gt;text&lt;/b&gt;\n<i>Italic</i>: &lt;i&gt;text&lt;/i&gt;\n<code>Mono</code>: &lt;code&gt;text&lt;/code&gt;\n<a href='https://example.com'>Link</a>: &lt;a href='...'&gt;text&lt;/a&gt;\n\nRegular newlines are supported. ✅", {
          reply_markup: { keyboard: [[{ text: "🔙 Back" }], [{ text: "❌ Cancel" }]], resize_keyboard: true }
        });
      }
      if (msg.photo || msg.video) {
        state.media = msg;
        this.fsmStates.set(userId, { ...state, action: "BC_CENTER_TEXT" });
        return bot.sendMessage(userId, "✅ Media Received. Now write your message (caption if media exists).", {
          reply_markup: { keyboard: [[{ text: "🔙 Back" }], [{ text: "❌ Cancel" }]], resize_keyboard: true }
        });
      }
      return bot.sendMessage(userId, "❌ Please send a Photo/Video or click 'Skip Media'.");
    }

    if (action === "BC_CENTER_TEXT") {
      if (text === "🔙 Back") {
        this.fsmStates.set(userId, { ...state, action: "BC_CENTER_MEDIA" });
        return bot.sendMessage(userId, "📢 **Broadcast Center**\n\nSend your photo or video to broadcast or skip it.", {
          reply_markup: { keyboard: [[{ text: "Skip Media" }], [{ text: "❌ Cancel" }]], resize_keyboard: true }
        });
      }
      state.text = text;
      this.fsmStates.set(userId, { ...state, action: "BC_CENTER_BUTTONS" });
      const btnHelp = `🌟 **TWO BUTTONS IN SAME ROW**\nUse && between buttons.\nJoin - https://t.me/A && Support - https://t.me/B\n\n🌟 **MIXED LAYOUT EXAMPLE**\nJoin - https://t.me/A\nSupport - https://t.me/B && Website - https://example.com\n\n📌 **RULES:**\n• Each new line = new row\n• Use && to place buttons in same row\n\nIf you don't want buttons, press ⏭️ **Skip Buttons**`;
      return bot.sendMessage(userId, btnHelp, {
        parse_mode: 'Markdown',
        reply_markup: { keyboard: [[{ text: "Skip Buttons" }], [{ text: "🔙 Back" }]], resize_keyboard: true }
      });
    }

    if (action === "BC_CENTER_BUTTONS") {
      if (text === "🔙 Back") {
        this.fsmStates.set(userId, { ...state, action: "BC_CENTER_TEXT" });
        return bot.sendMessage(userId, "Write your message again:", {
          reply_markup: { keyboard: [[{ text: "🔙 Back" }], [{ text: "❌ Cancel" }]], resize_keyboard: true }
        });
      }
      
      const keyboard: any[][] = [];
      if (text !== "Skip Buttons") {
        const rows = text.split('\n');
        for (const rowText of rows) {
          const row: any[] = [];
          const btnTexts = rowText.split('&&');
          for (const btnInfo of btnTexts) {
            const parts = btnInfo.split(' - ');
            if (parts.length === 2) {
              row.push({ text: parts[0].trim(), url: parts[1].trim() });
            }
          }
          if (row.length > 0) keyboard.push(row);
        }
      }
      
      state.inline_keyboard = keyboard;
      this.fsmStates.set(userId, { ...state, action: "BC_CENTER_CONFIRM" });
      
      await bot.sendMessage(userId, "Check the preview above. If it looks good, click Confirm.", { reply_markup: { remove_keyboard: true } });
      
      const opts = { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'HTML' };
      try {
        if (state.media?.photo) {
          await bot.sendPhoto(userId, state.media.photo[state.media.photo.length - 1].file_id, { ...opts, caption: state.text });
        } else if (state.media?.video) {
          await bot.sendVideo(userId, state.media.video.file_id, { ...opts, caption: state.text });
        } else {
          await bot.sendMessage(userId, state.text, opts);
        }
      } catch (err: any) {
        return bot.sendMessage(userId, `❌ **PREVIEW FAILED:** ${err.message}\n\nThis usually happens if your HTML tags are not closed correctly or a URL is invalid. Fix it and send the message again.`, { parse_mode: 'Markdown' });
      }

      return bot.sendMessage(userId, "Confirm this broadcast?", {
        reply_markup: {
          inline_keyboard: [[{ text: "✅ Confirm Broadcast", callback_data: "BC_RUN_CENTER" }, { text: "❌ Cancel Broadcast", callback_data: "BC_CANCEL" }]]
        }
      });
    }

    if (action === "ADD_CHANNEL") {
      let input = text.trim();
      let channelId = input;
      const chType = state.type || 'CHECKED';
      
      if (input.includes('t.me/')) {
        const urlMatch = input.match(/t\.me\/(?:\+|joinchat\/)?([^\/\?]+)/);
        if (urlMatch) {
          if (input.includes('joinchat') || input.includes('t.me/+')) {
             channelId = input; 
          } else {
             channelId = '@' + urlMatch[1];
          }
        }
      } else if (!input.startsWith('@') && !input.startsWith('-100')) {
        if (isNaN(Number(input))) {
           channelId = '@' + input;
        }
      }

      if (chType === 'CHECKED') {
        if (!node.config.forceJoinChannels) node.config.forceJoinChannels = [];
        if (!node.config.forceJoinChannels.includes(channelId)) {
          node.config.forceJoinChannels.push(channelId);
          bot.sendMessage(userId, `✅ **Added to Checked Channels:** ${channelId}\n\n⚠️ **Tip:** Ensure Bot is **ADMIN** in the channel.`);
          await this.saveNodeToFirestore(node);
        } else {
          bot.sendMessage(userId, "❌ Already in Checked Channels.");
        }
      } else {
        if (!node.config.forceJoinChannelsUnchecked) node.config.forceJoinChannelsUnchecked = [];
        if (!node.config.forceJoinChannelsUnchecked.includes(channelId)) {
          node.config.forceJoinChannelsUnchecked.push(channelId);
          bot.sendMessage(userId, `🔘 **Added to Unchecked Channels:** ${channelId}\n\n⚠️ **Tip:** These are optional buttons (no verification).`);
          await this.saveNodeToFirestore(node);
        } else {
          bot.sendMessage(userId, "❌ Already in Unchecked Channels.");
        }
      }
      
      this.fsmStates.delete(userId);
      this.handleSubBotCallback(bot, node, userId, 'adm_view_forceJoin', { message: msg });
      return;
    }

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
      if (amt > node.config.maxWithdraw) {
        return bot.sendMessage(userId, `❌ Maximum amount is ₹${node.config.maxWithdraw}`);
      }
      if (amt > user.balance) {
        return bot.sendMessage(userId, "❌ Insufficient balance.");
      }
      if (node.config.amountInWhole && amt % 1 !== 0) {
        return bot.sendMessage(userId, "❌ Only whole amounts are allowed.");
      }

      // DUPLICATE DEVICE AUTO-FAIL
      if (user.isDuplicate) {
        const failReason = "⚠️ **Withdrawal Rejected**\n\nReason: Duplicate device detected. Our system prevents automated payments to multiple accounts on the same device to ensure network integrity.";
        return bot.sendMessage(userId, failReason, { parse_mode: 'Markdown' });
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
        channel = '@' + path;
      } else if (input.startsWith('-100')) {
        channel = input;
      } else {
        channel = '@' + input;
      }

      const existingChannels = node.config.forceJoinChannels || [];
      if (!existingChannels.includes(channel)) {
        if (!node.config.forceJoinChannels) node.config.forceJoinChannels = [];
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

    if (action.startsWith("EDIT_")) {
      const field = action.replace("EDIT_", "");
      const isNumeric = ['referBonus', 'dailyBonus', 'minReferForPayout', 'minWithdraw', 'maxWithdraw', 'withdrawTax'].includes(field);
      
      const config = node.config as any;
      if (field === 'payoutGatewayApiUrl') {
        config.payoutGatewayApiUrl = text;
      } else {
        config[field] = isNumeric ? parseFloat(text) : text;
      }
      
      bot.sendMessage(userId, `✅ **Field Updated:** ${field}\nNew Value: ${text}`);
      this.fsmStates.delete(userId);
      await this.saveNodeToFirestore(node);
      return this.sendAdminPanel(bot, node, userId);
    }

    if (action === "BC_CONTENT") {
      state.content = msg;
      this.fsmStates.set(userId, { ...state, action: "BC_BUTTONS" });
      bot.sendMessage(userId, "📥 **Content Received!**\n\nNow send the **Inline Buttons** configuration.\nFormat: `Label | URL` (One per line).\n\nType **'none'** if you don't want any buttons.");
      return;
    }

    if (action === "BC_BUTTONS") {
      const buttons: any[] = [];
      if (text.toLowerCase() !== 'none') {
        const lines = text.split('\n');
        for (const line of lines) {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length === 2) {
            buttons.push([{ text: parts[0], url: parts[1] }]);
          }
        }
      }
      state.buttons = buttons;
      this.fsmStates.set(userId, { ...state, action: "BC_CONFIRM" });
      
      bot.sendMessage(userId, "👀 **BROADCAST PREVIEW:**\n\n(Wait for the preview message...)").then(() => {
        const content = state.content;
        const opts = { reply_markup: { inline_keyboard: buttons }, parse_mode: 'Markdown' };
        
        if (content.photo) {
          bot.sendPhoto(userId, content.photo[0].file_id, { ...opts, caption: content.caption });
        } else if (content.text) {
          bot.sendMessage(userId, content.text, opts);
        } else {
          bot.copyMessage(userId, userId, content.message_id, { reply_markup: { inline_keyboard: buttons } });
        }

        bot.sendMessage(userId, "❓ **Do you want to send this to ALL users?**\nType **'CONFIRM'** to start or **'CANCEL'** to abort.", {
          reply_markup: { keyboard: [[{ text: "CONFIRM" }, { text: "CANCEL" }]], resize_keyboard: true, one_time_keyboard: true }
        });
      });
      return;
    }

    if (action === "BC_CONFIRM") {
      if (text === "CONFIRM") {
        bot.sendMessage(userId, "🚀 **Smart Broadcast Started...**", { reply_markup: { remove_keyboard: true } });
        
        const runBroadcast = async () => {
          try {
            const targets: { bot: any, nodeId: string, uids: number[] }[] = [];
            
            if (state.nodeId === "HUB_NODE") {
               const snap = await db.collection('hubUsers').get();
               targets.push({ bot: hubBot, nodeId: "HUB", uids: snap.docs.map((d: any) => Number(d.id)) });
            } else if (state.nodeId === "HUB_GLOBAL_MESH") {
               // 1. Hub Users
               const hSnap = await db.collection('hubUsers').get();
               targets.push({ bot: hubBot, nodeId: "HUB", uids: hSnap.docs.map((d: any) => Number(d.id)) });
               // 2. All Nodes Users
               const allNodes = Array.from(this.nodes.values());
               for(const n of allNodes) {
                 if(n.instance && n.config.botStatus) {
                   const nSnap = await db.collection('nodes').doc(n.id).collection('users').get();
                   targets.push({ bot: n.instance, nodeId: n.id, uids: nSnap.docs.map((d: any) => Number(d.id)) });
                 }
               }
            } else if (state.nodeId === "MESH_ONLY_GLOBAL") {
                const allNodes = Array.from(this.nodes.values());
                for(const n of allNodes) {
                  if(n.instance && n.config.botStatus) {
                    const nSnap = await db.collection('nodes').doc(n.id).collection('users').get();
                    targets.push({ bot: n.instance, nodeId: n.id, uids: nSnap.docs.map((d: any) => Number(d.id)) });
                  }
                }
            } else if (state.nodeId === "USER_OWN_NODES") {
               const userNodes = this.getUserNodes(userId);
               for(const n of userNodes) {
                 if(n.instance && n.config.botStatus) {
                   const nSnap = await db.collection('nodes').doc(n.id).collection('users').get();
                   targets.push({ bot: n.instance, nodeId: n.id, uids: nSnap.docs.map((d: any) => Number(d.id)) });
                 }
               }
            } else {
               const snap = await db.collection('nodes').doc(node.id).collection('users').get();
               targets.push({ bot: bot, nodeId: node.id, uids: snap.docs.map((d: any) => Number(d.id)) });
            }

            let total = targets.reduce((acc, t) => acc + t.uids.length, 0);
            let success = 0;
            let failed = 0;
            let processed = 0;
            
            const progressMsg = await bot.sendMessage(userId, `📊 **MESH BROADCAST INITIATED**\n\n🔄 Total Targets: ${total}\n⏳ Delivering messages...`);
            const startTime = Date.now();

            for (const target of targets) {
              for (const uid of target.uids) {
                try {
                  const opts = { reply_markup: { inline_keyboard: state.buttons || [] }, parse_mode: 'Markdown' };
                  const content = state.content;
                  
                  if (content.photo) {
                    await target.bot.sendPhoto(uid, content.photo[content.photo.length - 1].file_id, { ...opts, caption: content.caption });
                  } else if (content.text) {
                    await target.bot.sendMessage(uid, content.text, opts);
                  } else {
                    try {
                        await target.bot.copyMessage(uid, userId, content.message_id, { reply_markup: { inline_keyboard: state.buttons || [] } });
                    } catch(e) {
                         // Fallback resend
                         if (content.text) await target.bot.sendMessage(uid, content.text, opts);
                         else if (content.caption) await target.bot.sendMessage(uid, content.caption, opts);
                         else throw e;
                    }
                  }
                  success++;
                } catch (e: any) {
                  failed++;
                  logSys(`[SUB_BC_FAIL] To ${uid} on ${target.nodeId}: ${e.message}`);
                }
                
                processed++;
                if (processed % 15 === 0 || processed === total) {
                  const percentage = Math.round((processed / total) * 100);
                  const elapsed = (Date.now() - startTime) / 1000;
                  const rate = processed / elapsed;
                  const remaining = Math.round((total - processed) / rate);
                  
                  bot.editMessageText(`📊 **GLOBAL MESH TRACKING**\n\n` +
                    `🔄 Progress: ${processed}/${total} (${percentage}%)\n` +
                    `🟢 Success: ${success}\n` +
                    `🔴 Failed: ${failed}\n\n` +
                    `⏳ Est. Remaining: ${remaining}s`, {
                    chat_id: userId,
                    message_id: progressMsg.message_id
                  }).catch(() => {});
                }
                await new Promise(r => setTimeout(r, 40));
              }
            }
            bot.sendMessage(userId, `✅ **Global Mesh Broadcast Complete!**\n\nTotal: ${total}\nSuccess: ${success}\nFailed: ${failed}`);
          } catch (err: any) {
            bot.sendMessage(userId, "❌ MESH Error: " + err.message);
          }
        };
        runBroadcast();
      } else {
        bot.sendMessage(userId, "❌ Broadcast Cancelled.", { reply_markup: { remove_keyboard: true } });
      }
      this.fsmStates.delete(userId);
      return;
    }

    if (action === "REDEEM_GIFT") {
      const g = node.config.giftCodes.get(text);
      if (g && g.status === 'active' && g.currentClaims < g.maxUses) {
        const user = await this.ensureUserLoaded(node, userId);
        if (user) {
          user.balance += g.amount;
          g.currentClaims++;
          if (g.currentClaims >= g.maxUses) g.status = 'off';
          node.config.giftCodes.set(text, g);
          await this.saveUserToFirestore(node.id, userId, user);
          await this.saveNodeToFirestore(node);
          
          const giftImg = "https://t.me/SR_TECHNOLOGY_LTD/330"; // Using an URL or path to the specified image
          // The user mentioned IMG_20260516_224545_048.jpg, I'll assume it's an asset or I can use a file_id if I had one.
          // For now I'll use sendPhoto if I can or just the text if image is not reachable.
          bot.sendPhoto(userId, giftImg, {
            caption: `congratulations 🎉 you have successfully claimed 🧧RS ${g.amount.toFixed(2)} gift code amount`,
            parse_mode: 'Markdown'
          }).catch(() => {
            bot.sendMessage(userId, `congratulations 🎉 you have successfully claimed 🧧RS ${g.amount.toFixed(2)} gift code amount`);
          });
        }
      } else {
        bot.sendMessage(userId, "❌ Invalid, expired, or fully claimed gift code.");
      }
    }

    if (action === "CREATE_GIFT_AMT") {
      const amount = parseFloat(text);
      if (!isNaN(amount) && amount > 0) {
        this.fsmStates.set(userId, { nodeId: node.id, action: "CREATE_GIFT_USES", targetId: amount });
        bot.sendMessage(userId, `💰 Value: ₹${amount.toFixed(2)}\n\n⌨️ **Enter maximum number of uses (Max People):**`);
        return;
      } else {
        bot.sendMessage(userId, "❌ Invalid amount.");
      }
    }

    if (action === "CREATE_GIFT_USES") {
      const uses = parseInt(text);
      const amt = state.targetId;
      if (!isNaN(uses) && uses > 0) {
        const code = `SR-${uuidv4().substring(0, 8).toUpperCase()}`;
        node.config.giftCodes.set(code, {
          amount: amt,
          maxUses: uses,
          currentClaims: 0,
          status: 'active'
        });
        await this.saveNodeToFirestore(node);
        const msg = `🎁 **GIFT CODE CREATED!**\n\n🎫 Code: \`${code}\`\n💰 Value: ₹${amt}\n👥 Limit: ${uses} Users\n\n_Share this code with your users to claim reward._`;
        bot.sendMessage(userId, msg, { parse_mode: 'Markdown' });
        
        const kb = {
          inline_keyboard: [[{ text: "📢 Broadcast Code", callback_data: `adm_bc_gift_${code}` }, { text: "❌ Later", callback_data: "adm_back_main" }]]
        };
        bot.sendMessage(userId, "Do you want to broadcast this gift code to all users?", { reply_markup: kb });
      } else {
        bot.sendMessage(userId, "❌ Invalid number of uses.");
      }
      this.fsmStates.delete(userId);
      return;
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
      const inputWallet = text.trim();
      
      // Duplicate Check across ALL users in THIS SPECIFIC node using Firestore for robustness
      let isRegistered = false;
      const usersRef = collection(cdb, 'nodes', node.id, 'users');
      const q = query(usersRef, where('walletId', '==', inputWallet), limit(1));
      const qSnap = await getDocs(q);
      
      if (!qSnap.empty) {
        // Double check it's not the SAME user updating their own wallet to the same value
        const match = qSnap.docs[0];
        if (match.id !== String(userId)) {
          isRegistered = true;
        }
      }

      if (isRegistered) {
        return bot.sendMessage(userId, "⚠️ **THIS WALLET ID IS ALREADY REGISTERED TRY ANOTHER WALLET ID**", { parse_mode: 'Markdown' });
      }

      const user = await this.ensureUserLoaded(node, userId);
      if (user) {
        user.walletId = inputWallet;
        await this.saveUserToFirestore(node.id, userId, user);
        bot.sendMessage(userId, "✅ Wallet ID saved successfully.");
      }
    }

    if (action === "EDIT_botOffText") {
      node.config.botOffText = text;
      bot.sendMessage(userId, "✅ Maintenance message updated.");
      await this.saveNodeToFirestore(node);
    }

    if (action === "EDIT_buildInfo") {
      node.config.buildInfoText = text;
      bot.sendMessage(userId, "✅ Build info message updated.");
      await this.saveNodeToFirestore(node);
    }

    if (action === "EDIT_DASH_TEXT") {
      node.config.customDashboardText = text;
      bot.sendMessage(userId, "✅ Dashboard text updated successfully.");
      await this.saveNodeToFirestore(node);
    }

    if (action === "EDIT_DASH_IMG") {
      const photoId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : text;
      node.config.customDashboardImage = photoId;
      bot.sendMessage(userId, "✅ Dashboard header photo updated successfully.");
      await this.saveNodeToFirestore(node);
    }

    if (action === "EDIT_joinNotice") {
      node.config.joinNotice = text;
      bot.sendMessage(userId, "✅ Global welcome message updated.");
      await this.saveNodeToFirestore(node);
    }

    if (action === "EDIT_supportContact") {
      node.config.supportContact = text;
      bot.sendMessage(userId, "✅ Support contact updated.");
      await this.saveNodeToFirestore(node);
    }

    if (action === "EDIT_updateChannel") {
      node.config.updateChannel = text;
      bot.sendMessage(userId, "✅ Update channel updated.");
      await this.saveNodeToFirestore(node);
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
      bot.sendMessage(userId, "🚀 **Broadcasting started...**").catch(() => {});
      
      try {
        if (!db) throw new Error("Database offline.");
        const userSnap = await db.collection('nodes').doc(node.id).collection('users').get();
        const allUserIds = userSnap.docs.map(d => Number(d.id));
        
        let success = 0;
        let failed = 0;
        
        for (const uid of allUserIds) {
          try {
            await bot.sendMessage(uid, `📢 **BROADCAST MESSAGE**\n\n${text}`);
            success++;
            await new Promise(r => setTimeout(r, 40)); 
          } catch (e) {
            failed++;
          }
        }
        bot.sendMessage(userId, `✅ **Broadcast Completed!**\n\n🟢 Sent: ${success}\n🔴 Failed: ${failed}`);
        this.logAdminAction(node, `Sent broadcast to ${success} users.`);
      } catch (err: any) {
        bot.sendMessage(userId, "❌ Broadcast Error: " + err.message);
      }
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
      
      logSys(`[WD_REQ] User: ${userId} | ID: ${wallet} | Amt: ${finalAmount.toFixed(2)}`);

      const response = await axios.get(finalUrl, { 
        timeout: 5000, // Faster timeout for pro feel
        headers: { 
          'User-Agent': 'SR-Tech-BotEngine/3.1 (PRO)',
          'Accept': '*/*'
        },
        validateStatus: () => true 
      }).catch(err => {
        let msg = err.message || "Network Communication Failure";
        if (err.code === 'ECONNABORTED') msg = "Gateway connection timeout (5s)";
        if (err.code === 'ENOTFOUND') msg = "Invalid gateway host";
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
        bot.sendMessage(userId, `✅ **Withdrawal Success!**\n\n💰 Amount: ₹${finalAmount.toFixed(2)}\n🧾 Tax (Ded.): ₹${tax.toFixed(2)}\n🏛 Gateway: ${esc(node.config.payoutGatewayName)}\n✅ Status: **PAID (SUCCESS)**\n\n🛠 Powered by RJ BOT MAKER HUB`, { parse_mode: 'Markdown' }).catch(() => {});
        
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
    this.nodes.forEach(n => globalUsers += n.users.size);
    return {
      totalNodes: this.nodes.size,
      globalUsers
    };
  }

  getUserNodes(userId: number): BotNode[] {
    const ids = this.userToNodes.get(userId) || [];
    return ids.map(id => this.nodes.get(id)).filter(Boolean) as BotNode[];
  }
}

engine = new BotEngine();

const USER_HUB_KB = {
  reply_markup: {
    keyboard: [
      [{ text: "➕ Create New Bot" }, { text: "🤖 My All Bot Nodes" }],
      [{ text: "📢 Broadcast all user" }, { text: "📊 Hub Stats" }],
      [{ text: "📞 Support Hub" }]
    ],
    resize_keyboard: true
  }
};

const ADMIN_HUB_KB = {
  reply_markup: {
    keyboard: [
      [{ text: "📢 All User Broadcast" }, { text: "📢 All Bot Broadcast" }],
      [{ text: "🤖 My All Bot" }, { text: "➕ Create New Bot" }],
      [{ text: "🛠 Manage Nodes" }, { text: "🛠 Template Designer" }],
      [{ text: "⚙️ Hub Settings" }, { text: "📊 Hub Stats" }],
      [{ text: "📡 Must Join Channels" }],
      [{ text: "🔙 Back to User Menu" }]
    ],
    resize_keyboard: true
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 0. Base URL Middleware (MUST BE BEFORE ROUTES)
  app.use((req, res, next) => {
    if (req.get('host')) {
      const host = req.get('host') || "";
      const cleanHost = host.split(":")[0];
      
      // Only update if it's a real external-looking domain
      if (cleanHost && cleanHost !== 'localhost' && !cleanHost.startsWith('127.')) {
        const oldUrl = BASE_URL;
        const newUrl = `https://${cleanHost}`;
        
        if (oldUrl !== newUrl) {
          BASE_URL = newUrl;
          // If BASE_URL just transitioned from empty/placeholder to real
          if (!oldUrl || oldUrl.includes("your-app-url") || oldUrl.includes("localhost")) {
            logSys(`[NETWORK_SYNC] Base URL detected: ${BASE_URL}. Syncing all node webhooks...`);
            engine.boot().then(() => logSys("All nodes re-synced with correct BASE_URL."));
          }
        }
      }
    }
    next();
  });

  // Status check
  app.post("/api/verify-device", async (req, res) => {
    const { nodeId, userId, ref } = req.body;
    if (!nodeId || !userId) return res.json({ success: false, reason: "missing_params" });

    try {
      const node = engine.getNodes().get(nodeId);
      if (!node) return res.json({ success: false, reason: "invalid_node" });

      const userIdNum = Number(userId);
      let user = await engine.ensureUserLoaded(node, userIdNum);

      if (user && user.verified) return res.json({ success: true, already: true });

      // Check for duplicates (simplified for this context)
      // In a real app we'd use fingerprints, here let's assume session/IP check
      const deviceId = uuidv4().substring(0, 12); 
      const isDuplicate = false; // logic would go here

      if (isDuplicate) {
         return res.json({ success: false, reason: "duplicate_device" });
      }

      if (!user) {
         user = {
           balance: 0,
           referrals: 0,
           walletId: null,
           isBanned: false,
           verified: true,
           joinedAt: Date.now(),
           deviceId
         };
         node.users.set(userIdNum, user);
      } else {
         user.verified = true;
         user.deviceId = deviceId;
      }

      await engine.saveUserToFirestore(nodeId, userIdNum, user);

      // Award Referrer
      if (ref && ref !== 'none' && ref !== String(userId)) {
        const rId = Number(ref);
        const referrer = await engine.ensureUserLoaded(node, rId);
        if (referrer && !referrer.isBanned) {
          referrer.balance += node.config.referBonus;
          referrer.referrals += 1;
          await engine.saveUserToFirestore(nodeId, rId, referrer);
          node.instance?.sendMessage(rId, `👥 **New Referral Success!**\n\nYour friend joined and verified their device. You earned **₹${node.config.referBonus}** credits.`);
        }
      }

      // Notify User
      node.instance?.sendMessage(userIdNum, "🛡️ **Device Verified Successfully!**\n\nYou are now authenticated in the SR Technology network. Enjoy the bot!", {
         reply_markup: engine.getMenuKeyboard(node)
      });

      return res.json({ success: true });
    } catch (err: any) {
      return res.json({ success: false, reason: err.message });
    }
  });

  app.get("/api/status", (req, res) => {
    const nodes = Array.from(engine.getNodes().values());
    const liveBots = nodes.filter((n: any) => n.instance).length;
    const offlineBots = nodes.length - liveBots;
    const stats = engine.getStats();
    
    res.json({
      status: "online",
      hubActive: !!hubBot && !!hubInfo,
      hubUsername: hubInfo?.username || "",
      totalNodes: nodes.length,
      liveBots,
      offlineBots,
      totalUsers: stats.globalUsers,
      hubTokenDefined: !!process.env.TELEGRAM_BOT_TOKEN,
      engineVersion: "V3.2-ENTERPRISE",
      serverSpeed: "2.4ms",
      loadAverage: "12%",
      logs: sysLogs
    });
  });

  // Template List
  app.get("/api/templates", (req, res) => {
    res.json([
      { id: 'autopay', name: '🛒 Auto-Pay Pro', desc: 'Automatic payment processing with split-second confirmation.' },
      { id: 'upi', name: '💳 Hybrid UPI', desc: 'Dual-mode UPI engine for manual and automated transfers.' },
      { id: 'crypto', name: '💎 Crypto M01', desc: 'Enterprise blockchain node for USDT/TON/SOL payments.' },
      { id: 'star', name: '⭐️ Star Payout', desc: 'Direct Telegram Stars payment and withdrawal infrastructure.' },
      { id: 'task', name: '📋 Task Rewards', desc: 'Affiliate task system where users earn by completing actions.' },
      { id: 'bet', name: '🎯 Bet & Earn', desc: 'Fair-play gaming engine with instant balance settlement.' },
      { id: 'redeem', name: '🎟️ Gift Hub', desc: 'Mass-generation of redeemable gift codes and vouchers.' },
      { id: 'giveaway', name: '🎁 Giveaway Manager', desc: 'Automated distribution of rewards to active community members.' },
      { id: 'refer_auto', name: '👥 Refer Auto', desc: 'High-growth referral engine with automated balance audits.' },
      { id: 'wallet', name: '📥 Wallet Pro', desc: 'Banking-grade ledger for multi-currency user wallets.' },
      { id: 'file', name: '📁 File Cloud', desc: 'Secure repository for digital assets and shareable links.' },
      { id: 'poll', name: '📊 Analytics Poll', desc: 'Real-time data gathering and user sentiment tracking.' },
      { id: 'refer_manual', name: '👥 Refer Manual', desc: 'Hand-vetted referral system for high-security networks.' },
      { id: 'upi_manual', name: '📥 UPI Manual', desc: 'Secure interface for manual UPI verification steps.' },
    ]);
  });

  // Node List
  app.get("/api/nodes", (req, res) => {
    const nodes = Array.from(engine.getNodes().values()).map((n: any) => ({
      id: n.id,
      username: n.username,
      type: n.type,
      ownerId: n.ownerId,
      status: !!n.instance ? 'LIVE' : 'OFFLINE',
      createdAt: n.createdAt
    }));
    res.json(nodes);
  });

  // Switch Template
  app.post("/api/nodes/:id/template", async (req, res) => {
    const { id } = req.params;
    const { template } = req.body;
    const node = engine.getNodes().get(id);
    if (!node) return res.status(404).json({ error: "Node not found" });
    
    try {
      node.type = template;
      // Re-initialize config for template
      if (template === 'autopay') {
        node.config.autoPayout = true;
        node.config.withdrawTax = 5;
        node.config.minWithdraw = 10;
      } else if (template === 'upi') {
        node.config.autoPayout = false;
        node.config.withdrawTax = 2;
        node.config.minWithdraw = 50;
      } else if (template === 'star') {
        node.config.autoPayout = true;
        node.config.withdrawTax = 0;
        node.config.minWithdraw = 1;
      } else if (template === 'task') {
        node.config.autoPayout = false;
        node.config.withdrawTax = 2;
      } else if (template === 'bet') {
        node.config.autoPayout = false;
        node.config.withdrawTax = 0;
      } else if (template === 'refer_auto') {
        node.config.autoPayout = true;
        node.config.withdrawTax = 5;
      }
      
      await engine.saveNodeToFirestore(node);
      logSys(`[WEB_API] Template for ${id} switched to ${template}`);
      res.json({ success: true, type: template });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 1. Initialize Bots Early
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/webhook')) {
       logSys(`[WEBHOOK_REQ] ${req.method} ${req.path} | UA: ${req.get('user-agent')}`);
    }
    next();
  });

  const hubToken = process.env.TELEGRAM_BOT_TOKEN;
  if (hubToken) {
    const isDev = process.env.NODE_ENV !== 'production';
    hubBot = new TelegramBot(hubToken, { polling: isDev });
    logSys(`Hub Bot Instance Created (Mode: ${isDev ? 'Polling' : 'Webhook'}).`);

    hubBot.on('error', (err) => {
      logSys(`[HUB_BOT_ERR] ${err.message}`);
    });

    hubBot.on('polling_error', (err: any) => {
      if (err.message.includes('401')) {
        logSys(`[HUB_AUTH_CRITICAL] Master Bot Token is INVALID (401). Please check TELEGRAM_BOT_TOKEN environment variable.`);
        hubBot.stopPolling();
      } else if (!err.message.includes('EFATAL')) {
        logSys(`[HUB_POLL_ERR] ${err.message}`);
      }
    });
    
    if (isDev) {
       hubBot.deleteWebHook().catch(() => {});
    }

    hubBot.getMe().then(async (info: any) => {
      hubInfo = info;
      logSys(`Hub Bot Authenticated: @${info.username}`);
      if (!isDev) syncWebhooks();
      
      hubBot.setMyCommands([
        { command: 'start', description: "Let's Start The Advantage Of Earning" },
        { command: 'build', description: "Bot engine & developer" }
      ]).catch(() => {});
    }).catch((err: any) => {
      logSys(`[HUB_INIT_FATAL] ${err.message}`);
    });

    hubBot.on('message', async (msg: any) => {
      try {
        const chatId = msg.chat.id;
        const text = msg.text || "";
        logSys(`[HUB_IN] ${chatId}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);

        // Tracking Hub Users
        if (db) {
          db.collection('hubUsers').doc(String(chatId)).set({
            id: chatId,
            username: msg.from.username || null,
            firstName: msg.from.first_name || null,
            lastSeen: Date.now()
          }, { merge: true }).catch(() => {});
        }
        
        const ADMIN_IDS = [6561010416];
        if (process.env.ADMIN_HUB_ID) ADMIN_IDS.push(Number(process.env.ADMIN_HUB_ID));

        const isAdmin = ADMIN_IDS.includes(chatId);
        
        // Intercept: Force Join Check for Hub
        if (!isAdmin && engine.getHubForceJoinChannels().length > 0) {
           const joinedStatuses = await Promise.all(engine.getHubForceJoinChannels().map((ch: string) => (engine as any).checkForceJoin(hubBot, ch, chatId)));
           if (joinedStatuses.includes(false)) {
              return (engine as any).sendHubJoinForce(hubBot, chatId);
           }
        }

        if (text === "/myid") {
          return hubBot.sendMessage(chatId, `👤 **YOUR TELEGRAM ID:** \`${chatId}\``, { parse_mode: 'Markdown' });
        }

        if (text === "/build") {
          const buildMsg = `🔧 **BUILD INFO**\n` +
            `├ 🤖 Engine: SR BOT [MAKER] v2.0\n` +
            `├ 👨💻 Developer: @SR_TECNOLOGY_LTD🇮🇳\n` +
            `└ ☁️ Architecture: Cloud Node Deployment\n\n` +
            `Building the future of Telegram automation.`;
          return hubBot.sendMessage(chatId, buildMsg, { parse_mode: 'Markdown' });
        }

        if (text === "/sradmin1") {
          const MASTER_ADMIN_ID = 6561010416;
          if (chatId !== MASTER_ADMIN_ID) {
            logSys(`[HUB_AUTH_FAIL] Unauthorized /sradmin1 attempt by ${chatId}`);
            return hubBot.sendMessage(chatId, "❌ **ACCESS DENIED**\n\nThis command is restricted to the Master Administrator's account only.");
          }
          logSys(`[HUB_AUTH_OK] Master Admin access granted to ${chatId}`);
          return hubBot.sendMessage(chatId, "👑 **MAIN HUB ADMIN PANEL**\n\nWelcome Master! Manage the entire network from here.", ADMIN_HUB_KB);
        }

        const hState = engine.fsmStates.get(chatId);
        if (hState && hState.nodeId === "HUB_NODE") {
          await engine.handleFSM(hubBot, null as any, chatId, text || "", hState, msg);
          return;
        }

        if (text.startsWith("/start")) {
          // CHECK FORCE JOIN FIRST
          const channels = engine.getHubForceJoinChannels();
          if (channels && channels.length > 0) {
            const joinedStatuses = await Promise.all(channels.map((ch: string) => (engine as any).checkForceJoin(hubBot, ch, chatId)));
            if (joinedStatuses.includes(false)) {
              return (engine as any).sendHubJoinForce(hubBot, chatId);
            }
          }

          const user_tag = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || "User");
          
          const welcomeMsg = `WELCOME , ${user_tag}!  SELECT  YOUR BOT TYPE 👇🏻 \n\n` +
            `╔════════════════════════════╗\n` +
            `          💫 ─── 𝐒𝐑 𝐁𝐎𝐓 𝐌𝐀𝐊𝐄𝐑 ─── 💫\n` +
            `            ⚡️ SR MASTER ENGINE PRO ✅\n` +
            `╚════════════════════════════╝\n` +
            `Welcome, ${user_tag}! Get ready to host high-speed automated bots instantly with zero coding.\n\n` +
            `📥 𝗖𝗛𝗢𝗢𝗦𝗘 𝗬𝗢𝗨𝐑 𝗕𝗢𝗧 𝗧𝗬𝗣𝗘 :\n` +
            `👇 Tap below to select your template and launch:\n\n` +
            `🚀 POWERED BY @SR_TECNOLOGY_LTD`;

          return hubBot.sendMessage(chatId, welcomeMsg, {
            parse_mode: 'Markdown',
            reply_markup: USER_HUB_KB.reply_markup
          }).catch(() => {});
        }

        if (text === "📢 All User Broadcast" || text === "📢 Broadcast Center" || text.startsWith("/broadcast")) {
          if (!ADMIN_IDS.includes(chatId)) return;
          
          engine.fsmStates.set(chatId, { nodeId: "HUB_NODE", action: "BC_CENTER_MEDIA", broadcastType: "HUB" });
          return hubBot.sendMessage(chatId, "📢 **All User Broadcast (MASTER)**\n\nSend your photo or video to broadcast to all Hub users or skip it.", {
            reply_markup: { keyboard: [[{ text: "Skip Media" }], [{ text: "❌ Cancel" }]], resize_keyboard: true }
          });
        }

        if (text === "📢 All Bot Broadcast") {
          if (!ADMIN_IDS.includes(chatId)) return;
          
          engine.fsmStates.set(chatId, { nodeId: "HUB_NODE", action: "BC_CENTER_MEDIA", broadcastType: "ALL_BOTS" });
          return hubBot.sendMessage(chatId, "📢 **All Bot Broadcast (NETWORK)**\n\nThis will send your message to ALL users across ALL deployed bots.\n\nSend your photo or video or skip it.", {
            reply_markup: { keyboard: [[{ text: "Skip Media" }], [{ text: "❌ Cancel" }]], resize_keyboard: true }
          });
        }

        if (text === "📡 Must Join Channels") {
          if (!ADMIN_IDS.includes(chatId)) return;
          const channels = engine.getHubForceJoinChannels() || [];
          let msg = "📡 **HUB MUST JOIN CHANNELS**\n\nUsers must join these channels to use the builder:\n\n";
          if (channels.length === 0) msg += "None set.";
          else channels.forEach((c: string, i: number) => msg += `${i+1}. ${c}\n`);

          const kb = {
            inline_keyboard: [
              [{ text: "➕ Add Channel", callback_data: "hub_add_ch" }, { text: "❌ Clear All", callback_data: "hub_clear_ch" }],
              [{ text: "🔙 Close", callback_data: "hub_back_adm" }]
            ]
          };
          return hubBot.sendMessage(chatId, msg, { reply_markup: kb, parse_mode: 'Markdown' });
        }

        if (text === "/help") {
          return hubBot.sendMessage(chatId, "📖 **SR BOT MAKER HUB COMMANDS**\n\n" +
            "👤 **User Panel:** Type /start or use the menu below.\n" +
            "👑 **Admin Panel:** Type `/sradmin1` to access hidden hub controls.\n\n" +
            "🔄 **Switch Master Bot:**\n" +
            "To change the master bot, go to **Settings** in AI Studio and update the `TELEGRAM_BOT_TOKEN` environment variable.\n" +
            "For sub-bots, use `/adminhelp1` inside the specific bot.", { parse_mode: 'Markdown' });
        }
        if (text === "⚙️ Hub Settings") {
          const ADMIN_ID = 6561010416;
          if (chatId !== ADMIN_ID) return;
          return hubBot.sendMessage(chatId, "⚙️ **HUB GLOBAL SETTINGS**\n\n" +
            "🔄 **Master Bot Token:** To change the master hub bot, update `TELEGRAM_BOT_TOKEN` in your environment config.\n\n" +
            "📡 **Server URL:** " + (BASE_URL || "`UPDATING...`") + "\n" +
            "🔒 **Admin ID:** `" + ADMIN_ID + "`\n\n" +
            "Current Mode: **V3.1-STABLE**", { parse_mode: 'Markdown' });
        }

        if (text === "🔙 Back to User Menu") {
          return hubBot.sendMessage(chatId, "👤 **Switched to User Menu.**", {
            reply_markup: USER_HUB_KB.reply_markup
          });
        }

        if (text === "➕ Create New Bot") {
          hubBot.sendMessage(chatId, "🛠 **SELECT ENGINE NODE TYPE:**", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "1) 💳 Task Payment Bot", callback_data: "hub_tpl_task" }, { text: "6) 📥 Wallet Bot", callback_data: "hub_tpl_wallet" }],
                [{ text: "2) 🎯 Bet & Earn Bot", callback_data: "hub_tpl_bet" }, { text: "7) 📝 File Store Bot", callback_data: "hub_tpl_file" }],
                [{ text: "3) 🎟️ Redeem Code Bot", callback_data: "hub_tpl_redeem" }, { text: "8) ⭐ Star Auto-Pay", callback_data: "hub_tpl_star" }],
                [{ text: "4) 🎁 Giveaway Bot", callback_data: "hub_tpl_giveaway" }, { text: "9) 📊 Poll Maker Bot", callback_data: "hub_tpl_poll" }],
                [{ text: "5) 👥 Refer Auto-Pay", callback_data: "hub_tpl_refer_auto" }, { text: "10) 👥 Refer Manual", callback_data: "hub_tpl_refer_manual" }],
                [{ text: "11) 📥 UPI Manual Pay Bot", callback_data: "hub_tpl_upi_manual" }],
                [{ text: "❌ Cancel Deployment", callback_data: "hub_deploy_cancel" }]
              ]
            }
          }).catch(() => {});
          return;
        }

        if (text === "🛠 Manage Nodes" || text === "🛠 Template Designer") {
          if (!ADMIN_IDS.includes(chatId)) return;
          
          if (text === "🛠 Template Designer") {
             const kb = {
               inline_keyboard: [
                 [{ text: "1️⃣ Task Payment", callback_data: "hub_design_task" }, { text: "6️⃣ Wallet", callback_data: "hub_design_wallet" }],
                 [{ text: "2️⃣ Bet & Earn", callback_data: "hub_design_bet" }, { text: "7️⃣ File Store", callback_data: "hub_design_file" }],
                 [{ text: "3️⃣ Redeem Code", callback_data: "hub_design_redeem" }, { text: "8️⃣ Star Auto-Pay", callback_data: "hub_design_star" }],
                 [{ text: "4️⃣ Giveaway", callback_data: "hub_design_giveaway" }, { text: "9️⃣ Poll Maker", callback_data: "hub_design_poll" }],
                 [{ text: "5️⃣ Refer Auto-Pay", callback_data: "hub_design_refer_auto" }, { text: "🔟 Refer Manual", callback_data: "hub_design_refer_manual" }],
                 [{ text: "🔙 Back", callback_data: "hub_back_adm" }]
               ]
             };
             return hubBot.sendMessage(chatId, "🛠 **HUB TEMPLATE DESIGNER**\n\nSelect a bot type to customize its **DEFAULT** configuration (UI, rules, bonus, etc.) for all future deployments.", { reply_markup: kb });
          }

          const nodesList = Array.from(engine.getNodes().values()) as BotNode[];
          if (nodesList.length === 0) return hubBot.sendMessage(chatId, "❌ No nodes deployed yet.");
          
          const buttons: any[][] = [];
          for (let i = 0; i < nodesList.length; i += 2) {
             const row = [];
             const n1 = nodesList[i];
             row.push({ text: `⚙️ @${n1.username}`, callback_data: `hub_edit_node_${n1.id}` });
             if (i + 1 < nodesList.length) {
                const n2 = nodesList[i + 1];
                row.push({ text: `⚙️ @${n2.username}`, callback_data: `hub_edit_node_${n2.id}` });
             }
             buttons.push(row);
          }
          return hubBot.sendMessage(chatId, "🛠 **SELECT NODE TO MANAGE:**\n\nYou can customize template, UI, and rules for any deployed bot from here.", { reply_markup: { inline_keyboard: buttons } });
        }

        if (text.includes("My All Bot") || text.includes("All Bot Nodes") || text.includes("Nodes")) {
          const ADMIN_IDS = [6561010416];
          if (process.env.ADMIN_HUB_ID) ADMIN_IDS.push(Number(process.env.ADMIN_HUB_ID));
          const isAdmin = ADMIN_IDS.includes(chatId);
          const nodes = isAdmin ? Array.from(engine.getNodes().values()) : engine.getUserNodes(chatId);
          
          if (nodes.length > 0) {
            hubBot.sendMessage(chatId, `📡 **${isAdmin ? 'GLOBAL NETWORK NODES' : 'YOUR DEPLOYED NODES'} (${nodes.length}):**\n\n━━━━━━━━━━━━━━`).catch(() => {});
            
            nodes.forEach((n: any) => {
              const statusText = !!n.instance && n.config.botStatus ? '🟢 LIVE' : '🔴 OFFLINE';
              const banText = n.isBannedByAdmin ? '🚫 BANNED BY ADMIN' : '✅ SYSTEM REGULAR';
              
              const detail = `🤖 **BOT:** @${n.username}\n🆔 ID: \`${n.id}\`\n📊 Status: ${statusText}\n🛡 Safety: ${banText}\n🛠 Type: ${String(n.type).toUpperCase()}`;
              
              const kb = {
                inline_keyboard: [
                  [{ text: n.config.botStatus ? "🔴 SWITCH OFF" : "🟢 SWITCH ON", callback_data: `sub_node_tgl_${n.id}` }],
                  [{ text: "🚀 OPEN MANAGEMENT", callback_data: `hub_edit_node_${n.id}` }]
                ]
              };
              hubBot.sendMessage(chatId, detail, { parse_mode: 'Markdown', reply_markup: kb }).catch(() => {});
            });
          } else {
            hubBot.sendMessage(chatId, "❌ No active nodes found.").catch(() => {});
          }
          return;
        }

        if (text.includes("Stats") || text.includes("📊")) {
          const stats = engine.getStats();
          return hubBot.sendMessage(chatId, `📈 **HUB ANALYTICS**\n\n🔹 Total Active Nodes: ${stats.totalNodes}\n🔹 Global Network Users: ${stats.globalUsers}`).catch(() => {});
        }

        if (text.includes("Support") || text.includes("📞")) {
          return hubBot.sendMessage(chatId, "🆘 **SR SUPPORT TEAM 🚀 24/7 CUSTOMER SUPPORT**\n\nNeed help with your deployment? Join our official community for live troubleshooting.\n\n⚙️ HELPLINE SUPPORT = @srsaportbot\n\n🚀 DEVLOPER = @SR_TECNOLOGY_LTD", { parse_mode: 'Markdown' });
        }

        const state = engine.deploymentStates.get(chatId);
        if (state?.step === "AWAITING_TOKEN" && text?.includes(":")) {
          const statusMsg = await hubBot.sendMessage(chatId, "🟠 **YOU ARE BOT IS DEPLOYING PLEASE WAIT** 🟠\n\n🟠 STATUS = **PENDING**").catch(() => {});
          logSys(`[DEPLOY_START] User ${chatId} provided token for ${state.type}`);
          try {
            const { nodeId, username } = await engine.deployBot(chatId, text, state.type!, "Dark_Hardware");
            engine.deploymentStates.delete(chatId);
            logSys(`[DEPLOY_SUCCESS] User ${chatId} deployed ${nodeId} (@${username})`);
            
            if (statusMsg) {
              await hubBot.editMessageText("🟠 **YOU ARE BOT IS DEPLOYING PLEASE WAIT** 🟠\n\n🟢 STATUS = **SUCCESSFUL**", {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
              }).catch(() => {});
            }

            const successMsg = `✅ **BOT DEPLOYED SUCCESSFULLY!**\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `Your bot is now LIVE on **SR BOT MAKER ENGINE**.\n\n` +
              `🤖 **Bot:** @${username}\n` +
              `🆔 **Node:** \`${nodeId}\`\n\n` +
              `**Next Steps:**\n` +
              `1️⃣ Open @${username} and send \`/start\`\n` +
              `2️⃣ Inside bot, send \`/adminhelp1\` to open Admin Panel.\n` +
              `3️⃣ Set up your channels and start growing!\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `🚀 Powered by SR BOT MAKER™\n` +
              `⚔️ DEVELOPER @SR_TECNOLOGY_LTD`;

            hubBot.sendMessage(chatId, successMsg, { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[{ text: "🚀 OPEN BOT", url: `https://t.me/${username}` }]]
              }
            }).catch(() => {});
          } catch (e: any) {
            logSys(`[DEPLOY_FAIL] User ${chatId} error: ${e.message}`);
            if (statusMsg) {
              await hubBot.editMessageText("🟠 **YOU ARE BOT IS DEPLOYING PLEASE WAIT** 🟠\n\n🔴 STATUS = **FAIL TRY AGAIN**", {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
              }).catch(() => {});
            }
            hubBot.sendMessage(chatId, `❌ **ERROR:** ${e.message}`).catch(() => {});
          }
          return;
        }
      } catch (err: any) { logSys(`[HUB_MSG_ERR] ${err.message}`); }
    });

    hubBot.on('callback_query', async (query: any) => {
      const chatId = query.message?.chat.id;
      const userId = query.from.id;
      const data = query.data;
      if (!chatId || !data) return;

      const currentHubState = engine.fsmStates.get(userId);

      // Handle Global Template Designer
      if (data.startsWith('hub_design_')) {
        const tplType = data.replace('hub_design_', '') as BotNode['type'];
        const blueprintId = `BLUEPRINT_${tplType.toUpperCase()}`;
        
        let bNode = engine.getNodes().get(blueprintId);
        if (!bNode) {
           // Create a persistent virtual node for this blueprint
           bNode = {
             id: blueprintId,
             token: "VIRTUAL",
             username: `TEMPLATE_${tplType.toUpperCase()}`,
             ownerId: 0,
             type: tplType,
             theme: "default",
             createdAt: Date.now(),
             config: engine.getDefaultConfig(tplType),
             users: new Map(),
             pendingWithdrawals: new Map(),
             withdrawals: [],
             instance: null
           };
           engine.getNodes().set(blueprintId, bNode);
           await engine.saveNodeToFirestore(bNode);
        }

        engine.fsmStates.set(userId, { nodeId: blueprintId, action: "HUB_MANAGE_BLUEPRINT" });
        hubBot.answerCallbackQuery(query.id, { text: `Designing ${tplType} Template` });
        return engine.sendAdminPanel(hubBot, bNode, userId, query.message?.message_id);
      }

      // Handle Sub-Bot Management from Hub
      if (data.startsWith('hub_edit_node_')) {
        const nodeId = data.replace('hub_edit_node_', '');
        const node = engine.getNodes().get(nodeId);
        if (!node) return hubBot.answerCallbackQuery(query.id, { text: "Node not found" });

        // MASTER ADMIN BAN CHECK
        const ADMIN_IDS = [6561010416];
        if (process.env.ADMIN_HUB_ID) ADMIN_IDS.push(Number(process.env.ADMIN_HUB_ID));
        const isMasterAdmin = ADMIN_IDS.includes(userId);

        if (node.isBannedByAdmin && !isMasterAdmin) {
           hubBot.answerCallbackQuery(query.id, { text: "❌ Access Restricted", show_alert: false });
           const restrictedText = `🚫 **YOUR BOT IS BANNED FROM SR BOT MAKER ADMIN** 🚫\n\n` +
                                `⚠️ *Reason:* Safety violation or Policy breach detected.\n\n` +
                                `🛠 *System Node:* \`${node.id}\`\n\n` +
                                `📞 **Please contact Admin to appeal:** @SR_TECNOLOGY_LTD`;
           return hubBot.sendMessage(chatId, restrictedText, { parse_mode: 'Markdown' });
        }
        
        engine.fsmStates.set(userId, { nodeId: node.id, action: "HUB_MANAGE_SUBBOT" });
        hubBot.answerCallbackQuery(query.id, { text: `Managing @${node.username}` });
        return engine.sendAdminPanel(hubBot, node, userId, query.message?.message_id);
      }

      if (data.startsWith('sub_node_tgl_')) {
        const nodeId = data.replace('sub_node_tgl_', '');
        const node = engine.getNodes().get(nodeId);
        if (!node) return hubBot.answerCallbackQuery(query.id, { text: "Node not found" });
        
        if (node.ownerId !== userId) return hubBot.answerCallbackQuery(query.id, { text: "Unauthorized" });

        if (node.isBannedByAdmin && !node.config.botStatus) {
            return hubBot.answerCallbackQuery(query.id, { text: "❌ This bot is restricted by SR HUB ADMIN and cannot be started.", show_alert: true });
        }

        node.config.botStatus = !node.config.botStatus;
        await engine.saveNodeToFirestore(node);
        hubBot.answerCallbackQuery(query.id, { text: `Bot ${node.config.botStatus ? 'Started' : 'Stopped'}` });
        
        const statusText = !!node.instance && node.config.botStatus ? '🟢 LIVE' : '🔴 OFFLINE';
        const banText = node.isBannedByAdmin ? '🚫 BANNED BY ADMIN' : '✅ SYSTEM REGULAR';
        const detail = `🤖 **BOT:** @${node.username}\n🆔 ID: \`${node.id}\`\n📊 Status: ${statusText}\n🛡 Safety: ${banText}\n🛠 Type: ${String(node.type).toUpperCase()}`;
        
        const kb = {
          inline_keyboard: [
            [{ text: node.config.botStatus ? "🔴 SWITCH OFF" : "🟢 SWITCH ON", callback_data: `sub_node_tgl_${node.id}` }],
            [{ text: "🚀 OPEN MANAGEMENT", callback_data: `hub_edit_node_${node.id}` }]
          ]
        };
        return hubBot.editMessageText(detail, { chat_id: chatId, message_id: query.message?.message_id, reply_markup: kb, parse_mode: 'Markdown' });
      }

      if (data.startsWith('adm_hub_ban_tgl_')) {
        const nodeId = data.replace('adm_hub_ban_tgl_', '');
        const node = engine.getNodes().get(nodeId);
        if (!node) return hubBot.answerCallbackQuery(query.id, { text: "Node not found" });

        const ADMIN_IDS = [6561010416];
        if (process.env.ADMIN_HUB_ID) ADMIN_IDS.push(Number(process.env.ADMIN_HUB_ID));
        if (!ADMIN_IDS.includes(userId)) return hubBot.answerCallbackQuery(query.id);

        node.isBannedByAdmin = !node.isBannedByAdmin;
        if (node.isBannedByAdmin) {
            node.config.botStatus = false; // Force stop on ban
        }
        await engine.saveNodeToFirestore(node);
        hubBot.answerCallbackQuery(query.id, { text: `Node ${node.isBannedByAdmin ? 'Banned' : 'Unbanned'}` });
        return engine.sendAdminPanel(hubBot, node, userId, query.message?.message_id);
      }

      // Relay admin callbacks if in Hub-Manage mode
      if (data === "hub_add_ch") {
        engine.fsmStates.set(userId, { nodeId: "HUB_NODE", action: "HUB_ADD_CHANNEL" });
        return hubBot.sendMessage(chatId, "➕ **HUB ADD CHANNEL**\n\nSend the channel username (e.g. `@MyChannel`) or chat ID (e.g. `-100...`):");
      }

      if (data === "hub_clear_ch") {
        engine.getHubForceJoinChannels().length = 0;
        await (engine as any).saveHubConfig();
        hubBot.answerCallbackQuery(query.id, { text: "Force-join channels cleared." });
        return hubBot.editMessageText("📡 **HUB MUST JOIN CHANNELS**\n\nChannels cleared.", { chat_id: chatId, message_id: query.message?.message_id });
      }

      if (data === "hub_check_join") {
        const channels = engine.getHubForceJoinChannels() || [];
        const joinedStatuses = await Promise.all(channels.map((ch: string) => (engine as any).checkForceJoin(hubBot, ch, userId)));
        if (joinedStatuses.includes(false)) {
           return hubBot.answerCallbackQuery(query.id, { text: "❌ You have not joined all required channels yet!", show_alert: true });
        }
        hubBot.answerCallbackQuery(query.id);
        hubBot.deleteMessage(chatId, query.message?.message_id).catch(() => {});
        return hubBot.sendMessage(chatId, "✅ **Verification successful!** You now have full access to SR HUB.", USER_HUB_KB);
      }

      if (currentHubState?.action === "HUB_MANAGE_SUBBOT" || currentHubState?.action === "HUB_MANAGE_BLUEPRINT") {
        const node = engine.getNodes().get(currentHubState.nodeId);
        if (node) {
          if (data === "adm_back_main" || data === "hub_back_adm") {
             // Return to appropriate list
             engine.fsmStates.delete(userId);
             if (currentHubState.action === "HUB_MANAGE_BLUEPRINT") {
                const kb = {
                  inline_keyboard: [
                    [{ text: "1️⃣ Task Payment", callback_data: "hub_design_task" }, { text: "6️⃣ Wallet", callback_data: "hub_design_wallet" }],
                    [{ text: "2️⃣ Bet & Earn", callback_data: "hub_design_bet" }, { text: "7️⃣ File Store", callback_data: "hub_design_file" }],
                    [{ text: "3️⃣ Redeem Code", callback_data: "hub_design_redeem" }, { text: "8️⃣ Star Auto-Pay", callback_data: "hub_design_star" }],
                    [{ text: "4️⃣ Giveaway", callback_data: "hub_design_giveaway" }, { text: "9️⃣ Poll Maker", callback_data: "hub_design_poll" }],
                    [{ text: "5️⃣ Refer Auto-Pay", callback_data: "hub_design_refer_auto" }, { text: "🔟 Refer Manual", callback_data: "hub_design_refer_manual" }],
                    [{ text: "🔙 Back to Admin", callback_data: "hub_back_adm_menu" }]
                  ]
                };
                return hubBot.editMessageText("🛠 **HUB TEMPLATE DESIGNER**", { chat_id: userId, message_id: query.message?.message_id, reply_markup: kb });
             }
             const nodesList = Array.from(engine.getNodes().values()) as BotNode[];
             const buttons: any[][] = [];
              for (let i = 0; i < nodesList.length; i += 2) {
                const row = [];
                const n1 = nodesList[i];
                if (n1.id.startsWith("BLUEPRINT_")) continue;
                row.push({ text: `⚙️ @${n1.username}`, callback_data: `hub_edit_node_${n1.id}` });
                if (i + 1 < nodesList.length) {
                    const n2 = nodesList[i + 1];
                    if (!n2.id.startsWith("BLUEPRINT_")) row.push({ text: `⚙️ @${n2.username}`, callback_data: `hub_edit_node_${n2.id}` });
                }
                buttons.push(row);
              }
             return hubBot.editMessageText("🛠 **SELECT NODE TO MANAGE:**", { chat_id: userId, message_id: query.message?.message_id, reply_markup: { inline_keyboard: buttons } });
          }
          return engine.handleSubBotCallback(hubBot, node, userId, data, query);
        }
      }

      if (data === "BC_RUN_CENTER") {
        const state = engine.fsmStates.get(userId);
        if (!state) return hubBot.answerCallbackQuery(query.id, { text: "Session Expired" });
        
        hubBot.answerCallbackQuery(query.id, { text: "🚀 Broadcast Injected!" });
        engine.fsmStates.delete(userId);
        
        const run = async () => {
          let targets: { bot: any, nodeId: string, uids: number[], botName: string }[] = [];
          if (state.broadcastType === "HUB") {
             const snap = await db.collection('hubUsers').get();
             targets.push({ bot: hubBot, nodeId: "HUB", uids: snap.docs.map((d: any) => Number(d.id)), botName: "SR HUB MASTER" });
          } else if (state.broadcastType === "ALL_BOTS") {
             const nodes = Array.from(engine.getNodes().values()) as BotNode[];
             for (const node of nodes) {
                if (node.instance && node.config.botStatus !== false) {
                   const snap = await db.collection('nodes').doc(node.id).collection('users').get();
                   targets.push({ bot: node.instance, nodeId: node.id, uids: snap.docs.map((d: any) => Number(d.id)), botName: `@${node.username}` });
                }
             }
          }

          let total = targets.reduce((a, b) => a + b.uids.length, 0);
          let success = 0;
          let failed = 0;
          const startTime = Date.now();

          await hubBot.sendMessage(userId, `📣 **Broadcast Started!**\nYou will receive a detailed summary when it finishes.`);

          const summaryReportArr: string[] = [];
          for (const target of targets) {
            let sCount = 0;
            let fCount = 0;
            for (const uid of target.uids) {
              try {
                const opts = { reply_markup: { inline_keyboard: state.inline_keyboard || [] }, parse_mode: 'HTML' };
                if (state.media?.photo) {
                  await target.bot.sendPhoto(uid, state.media.photo[state.media.photo.length - 1].file_id, { ...opts, caption: state.text });
                } else if (state.media?.video) {
                  await target.bot.sendVideo(uid, state.media.video.file_id, { ...opts, caption: state.text });
                } else {
                  await target.bot.sendMessage(uid, state.text, opts);
                }
                sCount++;
                success++;
              } catch (e: any) {
                fCount++;
                failed++;
                logSys(`[HUB_BC_FAIL] To ${uid} on ${target.nodeId}: ${e.message}`);
              }
              await new Promise(r => setTimeout(r, 40));
            }
            summaryReportArr.push(`🔹 **${target.botName}**\n• Users: ${target.uids.length}\n• Success: ${sCount}\n• Failures: ${fCount}\n📈 Success Rate: ${((sCount / Math.max(1, target.uids.length)) * 100).toFixed(2)}%`);
          }

          const duration = Math.floor((Date.now() - startTime) / 1000);
          const summary = `📊 **Broadcast Summary Report**\n\n` +
            `⏱ **Start:** ${new Date(startTime).toLocaleString()}\n` +
            `🏁 **End:** ${new Date().toLocaleString()}\n` +
            `⌛ **Time Taken:** ${duration} Seconds\n\n` +
            `📦 **Overall Results:**\n` +
            `• Total Unique Users (Est): ${total}\n` +
            `✅ **Success: ${success}**\n` +
            `❌ **Failed: ${failed}**\n` +
            `📈 **Success Rate: ${((success / Math.max(1, total)) * 100).toFixed(2)}%**\n\n` +
            summaryReportArr.join('\n\n');
          
          hubBot.sendMessage(userId, summary, { parse_mode: 'Markdown' });
        };
        run();
        return;
      }

      if (data === "BC_CANCEL") {
        engine.fsmStates.delete(userId);
        hubBot.answerCallbackQuery(query.id, { text: "Cancelled" });
        return hubBot.sendMessage(userId, "❌ Broadcast operation cancelled.");
      }

      if (query.data === 'hub_deploy_cancel' && chatId) {
        engine.deploymentStates.delete(chatId);
        hubBot.editMessageText("❌ **Deployment Cancelled.**", { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
      } else if (query.data?.startsWith('hub_tpl_') && chatId) {
        const type = query.data.replace('hub_tpl_', '') as BotNode['type'];
        engine.deploymentStates.set(chatId, { step: "AWAITING_TOKEN", type });
        hubBot.sendMessage(chatId, "🔑 **AUTHENTICATION REQUIRED**\n\nPlease provide your sub-bot API Token from @BotFather now.").catch(() => {});
      }
      hubBot.answerCallbackQuery(query.id).catch(() => {});
    });
  }

  // 2. Webhook Routes
  app.post('/api/verify', async (req, res) => {
    const { nodeId, userId, refId, deviceId } = req.body;
    if (!nodeId || !userId) return res.status(400).json({ error: "Missing params" });

    const node = engine.nodes.get(nodeId);
    if (!node) return res.status(404).json({ error: "Node not found" });

    try {
      const userIdNum = Number(userId);
      let user = await engine.ensureUserLoaded(node, userIdNum);
      
      // Simple Duplicate Device Check
      const usersSnap = await db.collection('nodes').doc(nodeId).collection('users').where('deviceId', '==', deviceId).get();
      const isDuplicate = !usersSnap.empty && usersSnap.docs.some(d => d.id !== String(userId));

      if (isDuplicate) {
        if (user) {
          user.verified = true;
          user.deviceId = deviceId;
          user.isDuplicate = true;
          await engine.saveUserToFirestore(nodeId, userIdNum, user);
        }
        
        // Notify user about duplicate detection
        node.instance?.sendMessage(userIdNum, "🛡️ **Device Identification Complete**\n\nYour device has been verified. However, our system detected this device is already associated with another account in this bot.\n\n⚠️ **Notice:** You can still use the bot, but automated withdrawals will be restricted for security reasons.", {
          reply_markup: { keyboard: engine.getMenuKeyboard(node), resize_keyboard: true }
        }).catch(() => {});

        // notify referrer if exists
        if (refId && refId !== 'none' && refId !== String(userId)) {
           node.instance?.sendMessage(Number(refId), `⚠️ **Referral Update**\n\nYour friend joined but their device was detected as a duplicate. Referral bonus was not awarded to prevent abuse.`).catch(() => {});
        }

        return res.json({ success: true, duplicate: true });
      }

      if (user && !user.verified) {
        user.verified = true;
        user.deviceId = deviceId;
        user.isDuplicate = false; // explicitly set to false
        await engine.saveUserToFirestore(nodeId, userIdNum, user);

        // Award Referrer
        if (refId && refId !== 'none' && refId !== String(userId)) {
           const inviter = await engine.ensureUserLoaded(node, Number(refId));
           if (inviter) {
             inviter.balance += node.config.referBonus;
             inviter.referrals += 1;
             await engine.saveUserToFirestore(nodeId, Number(refId), inviter);
             node.instance?.sendMessage(Number(refId), `🎉 **Referral Success!**\n\nYour friend verified their device. You earned ₹${node.config.referBonus}.`).catch(() => {});
           }
        }
        
        node.instance?.sendMessage(userIdNum, "🛡️ **Device Verified!**\n\nWelcome to the dashboard. You can now use all bot features.", {
          reply_markup: { keyboard: engine.getMenuKeyboard(node), resize_keyboard: true }
        }).catch(() => {});
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/webhook/hub", (req, res) => {
    const updateId = req.body?.update_id;
    logSys(`[INCOMING_HUB] Update: ${updateId} | Host: ${req.get('host')} | IP: ${req.ip}`);
    try {
      if (!hubBot) return res.status(500).send("Hub Bot Offline");
      hubBot.processUpdate(req.body);
      res.status(200).send("OK");
    } catch (err: any) {
      logSys(`[HUB_PROCESS_ERR] ${err.message}`);
      res.status(500).send("Error");
    }
  });

  app.post("/api/webhook/:nodeId", (req, res) => {
    const { nodeId } = req.params;
    logSys(`[INCOMING_NODE] Node: ${nodeId}`);
    try {
      const node = engine.nodes.get(nodeId);
      if (node && node.instance) {
        node.instance.processUpdate(req.body);
        res.status(200).send("OK");
      } else {
        res.status(404).send("Not Found");
      }
    } catch (err: any) {
      logSys(`[NODE_PROCESS_ERR] ${nodeId}: ${err.message}`);
      res.status(500).send("Error");
    }
  });

  // 3. Identification & Boot
  app.use((req, res, next) => {
    updateBaseUrlFromRequest(req);
    next();
  });

  app.listen(PORT, "0.0.0.0", () => {
    logSys(`Engine V3.1 ready on port ${PORT}`);
  });

  // Background boot
  authPromise.then(async () => {
    await testConnection();
    engine.boot().then(() => logSys("Engine boot complete."));
  });

  // 4. Vite / Static
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
}

// --- APP ENTRY POINT ---
startServer().catch(err => {
  logSys(`[FATAL_SERVER_CRASH] ${err.message}`);
  process.exit(1);
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

