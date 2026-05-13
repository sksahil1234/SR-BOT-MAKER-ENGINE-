/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Terminal, 
  Zap, 
  ShieldCheck,
  Wallet,
  Cpu,
  Activity,
  ArrowRight,
  Database,
  Lock,
  Globe,
  Server
} from 'lucide-react';

// Common Colors as per Recipe 3: Hardware / Specialist Tool
const THEME = {
  bg: 'bg-[#05070a]',
  card: 'bg-[#0d1117]',
  accent: 'text-orange-600',
  accentBg: 'bg-orange-600',
  secondary: 'text-gray-500',
  border: 'border-white/10',
  fontMono: 'font-mono'
};

const FEATURES = [
  { id: '01', title: 'Multi-Instance Core', desc: 'Enterprise-grade asynchronicity for high-throughput node management.', icon: Cpu },
  { id: '02', title: 'Economy Engine', desc: 'Real-time referral tracking and dynamic balance calculations.', icon: Wallet },
  { id: '03', title: 'ISO Cloud Mesh', desc: 'Decentralized hosting infrastructure with 99.9% network availability.', icon: Server },
  { id: '04', title: 'Node ID Protocol', desc: 'Proprietary SR-XXXXXX identification for sub-bot tracing.', icon: Database },
  { id: '05', title: 'Anti-Fraud DPI', desc: 'Deep Packet Inspection to eliminate double-spending and balance leaks.', icon: ShieldCheck },
  { id: '06', title: 'Star Gateway v2', desc: 'Direct Telegram API integration for wholesale Star recharges.', icon: Zap },
  { id: '07', title: 'Zero-Knowledge Security', desc: 'End-to-end encryption for all API credentials and node tokens.', icon: Lock },
  { id: '08', title: 'Webhook Bridge', desc: 'Instant feedback loops for automated payment verification.', icon: Globe },
];

export default function App() {
  const [hubStatus, setHubStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let failCount = 0;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.substring(0, 100)}`);
        }
        const data = await res.json();
        setHubStatus(data);
        failCount = 0;
      } catch (err: any) {
        console.error("Link Failure:", err);
        failCount++;
        // Refresh page if multiple consecutive failures to clear potential stuck state
        if (failCount > 10) {
           window.location.reload();
        }
        // If it's a "Failed to fetch", the server might be restarting
        if (err.message === 'Failed to fetch') {
           setHubStatus((prev: any) => ({ ...prev, isRestarting: true }));
        }
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !hubStatus) {
    return (
      <div className={`min-h-screen ${THEME.bg} flex flex-col items-center justify-center font-mono`}>
        <div className="relative">
          <Terminal className={`w-16 h-16 ${THEME.accent} animate-pulse`} />
          <div className="absolute inset-0 border-2 border-orange-600/20 rounded-full scale-150 animate-ping" />
        </div>
        <span className="mt-12 text-[10px] tracking-[0.8em] text-gray-500 uppercase animate-pulse">Establishing Secure Uplink</span>
      </div>
    );
  }

  if (!loading && (!hubStatus || hubStatus.isRestarting)) {
    return (
      <div className={`min-h-screen ${THEME.bg} flex flex-col items-center justify-center font-mono p-8 text-center`}>
        <div className="relative mb-8">
          <Terminal className={`w-16 h-16 ${hubStatus?.isRestarting ? 'text-orange-600 animate-pulse' : 'text-red-600'}`} />
          <div className={`absolute inset-0 border-2 ${hubStatus?.isRestarting ? 'border-orange-600/20' : 'border-red-600/20'} rounded-full scale-150 animate-pulse`} />
        </div>
        <h2 className={`text-xl font-black ${hubStatus?.isRestarting ? 'text-orange-600' : 'text-red-600'} uppercase tracking-tighter mb-4`}>
          {hubStatus?.isRestarting ? 'System Synchronizing' : 'Uplink Failure'}
        </h2>
        <p className="text-gray-500 max-w-sm text-[10px] leading-relaxed uppercase tracking-widest mb-8">
          {hubStatus?.isRestarting 
            ? 'The SR Engine kernel is hot-reloading its configuration mesh. Please standby for link re-establishment.'
            : 'Unable to establish secure connection with the SR deployment mesh. The kernel may be offline.'}
        </p>

        {hubStatus?.logs && (
          <div className="w-full max-w-lg bg-black/40 border border-white/5 p-4 mb-8 text-left h-48 overflow-y-auto custom-scrollbar">
             <div className="text-[9px] text-orange-600/50 mb-2 uppercase tracking-widest border-b border-white/5 pb-1">Core Kernel Logs</div>
             {hubStatus.logs.slice().reverse().map((log: string, i: number) => (
               <div key={i} className="text-[9px] text-gray-600 mb-1 font-mono break-all leading-tight">
                 <span className="text-orange-600/30 mr-2">{'>'}</span>
                 {log}
               </div>
             ))}
          </div>
        )}

        <button 
          onClick={() => window.location.reload()}
          className={`px-8 py-3 border ${hubStatus?.isRestarting ? 'border-orange-600 text-orange-600' : 'border-red-600 text-red-600'} text-[10px] font-black uppercase tracking-[0.2em] hover:bg-orange-600 hover:text-black transition-all`}
        >
          {hubStatus?.isRestarting ? 'Awaiting Protocol' : 'Re-establish Link'}
        </button>
      </div>
    );
  }

  const hubUrl = hubStatus?.hubUsername ? `https://t.me/${hubStatus.hubUsername}` : '#';
  const isOperational = hubStatus?.hubActive;

  return (
    <div className={`min-h-screen ${THEME.bg} text-white selection:bg-orange-600/30 overflow-x-hidden font-sans`}>
      {/* HUD Navigation */}
      <nav className={`fixed top-0 w-full z-50 px-8 py-5 border-b ${THEME.border} backdrop-blur-3xl bg-[#05070a]/90`}>
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-sm bg-orange-600 flex items-center justify-center text-black shadow-[0_0_15px_rgba(234,88,12,0.4)]`}>
              <Cpu className="w-6 h-6" />
            </div>
            <div className="flex flex-col">
              <span className={`text-lg font-black tracking-tighter leading-none`}>SR TECHNOLOGY LTD™</span>
              <span className={`text-[8px] font-bold ${THEME.secondary} tracking-[0.4em] uppercase`}>Advanced Deploy Engine v2.5</span>
            </div>
          </div>
          
          <div className="hidden lg:flex items-center gap-12">
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">Mesh Status</span>
                <span className={`text-[10px] font-mono font-bold ${isOperational ? 'text-green-500' : 'text-red-500'}`}>
                  {isOperational ? 'LINK_ACTIVE' : 'LINK_INTERRUPTED'}
                </span>
              </div>
              <div className={`h-10 w-[1px] bg-white/5`} />
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">Active Nodes</span>
                <span className="text-[10px] font-mono font-bold text-orange-600 underline">#{hubStatus?.totalNodes || 0} DEPLOYED</span>
              </div>
            </div>
            <a 
              href={hubUrl}
              target="_blank"
              rel="noreferrer"
              className={`px-8 py-3 rounded-none border-2 border-orange-600 ${isOperational ? 'bg-orange-600 text-black' : 'opacity-20 pointer-events-none'} text-[10px] font-black uppercase tracking-[0.2em] hover:bg-black hover:text-orange-600 transition-all`}
            >
              {isOperational ? 'Initialize Hub' : 'System Booting'}
            </a>
          </div>
        </div>
      </nav>

      {/* Hero: Industrial Design */}
      <section className="relative pt-60 pb-32 px-8 overflow-hidden">
        {/* Background Grid Accent */}
        <div className="absolute top-0 left-0 w-full h-[500px] bg-[radial-gradient(circle_at_center,_rgba(234,88,12,0.05)_0%,_transparent_70%)] pointer-events-none" />
        
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-32 items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className={`inline-flex items-center gap-3 px-4 py-2 border ${THEME.border} bg-white/[0.02] mb-10`}>
              <div className="w-1.5 h-1.5 rounded-full bg-orange-600 animate-pulse" />
              <span className={`text-[9px] font-mono font-bold uppercase tracking-[0.3em] ${THEME.secondary}`}>Protocol_Alpha: Online</span>
            </div>
            
            <h1 className="text-7xl md:text-9xl font-black leading-[0.8] tracking-tighter mb-12 uppercase italic">
              Bot <br />
              <span className="text-orange-600">Maker</span> <br />
              <span className="opacity-20 underline decoration-orange-600">Engine</span>
            </h1>
            
            <p className="text-xl text-gray-500 max-w-lg mb-16 leading-relaxed font-medium">
              Enterprise-grade deployment hub for Telegram sub-bots. Automated UPI, Crypto, and Star payment infrastructure with advanced owner administration.
            </p>
            
            <div className="flex flex-wrap gap-8">
              <a 
                href={hubUrl}
                target="_blank"
                rel="noreferrer"
                className={`group flex items-center gap-6 px-12 py-6 ${isOperational ? 'bg-orange-600' : 'bg-gray-800 pointer-events-none'} text-black font-black uppercase tracking-tighter hover:scale-[1.02] active:scale-[0.98] transition-all`}
              >
                {isOperational ? 'Deploy First Node' : 'System Initializing'}
                <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
              </a>
              <div className={`flex items-center gap-4 px-10 py-6 border ${THEME.border} bg-white/[0.02]`}>
                <ShieldCheck className="w-6 h-6 text-gray-400" />
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Mesh Certified</span>
              </div>
            </div>
          </motion.div>

          {/* Terminal Monitor UI */}
          <div className="relative group">
            <div className="absolute -inset-1 bg-orange-600/20 rounded-none blur-3xl opacity-20 group-hover:opacity-40 transition duration-1000" />
            <div className={`relative aspect-square rounded-none ${THEME.card} border-4 ${THEME.border} p-12 flex flex-col font-mono shadow-2xl overflow-hidden`}>
              <div className="flex items-center justify-between mb-12 border-b border-white/10 pb-6">
                <div className="flex items-center gap-3">
                  <Activity className="w-4 h-4 text-orange-600 animate-pulse" />
                  <span className="text-[10px] text-orange-600 font-bold uppercase tracking-[0.4em]">Live Kernel Log</span>
                </div>
                <span className="text-[9px] text-gray-600 whitespace-nowrap">BUILD: {hubStatus?.engineVersion || '3.5.0-PRO'}</span>
              </div>
              
              <div className="flex-1 space-y-6 overflow-hidden">
                {[
                  { label: 'KERNEL_TASKS', val: 'MULTITHREADED_ASYNC', color: 'text-white' },
                  { label: 'MESH_ID', val: 'SR-HUB-DEPLOY-7', color: 'text-white' },
                  { label: 'NODE_IO', val: `${hubStatus?.totalNodes || 0} ACTIVE`, color: 'text-orange-600' },
                  { label: 'USER_METRIC', val: `${hubStatus?.totalUsers || 0} LINKED`, color: 'text-orange-600' },
                  { label: 'LATENCY_MS', val: '12.4ms', color: 'text-green-500' },
                  { label: 'FIREWALL', val: 'ACTIVE', color: 'text-green-500' }
                ].map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-[10px] border-b border-white/[0.02] pb-2">
                    <span className="text-gray-600 tracking-widest">{item.label}</span>
                    <span className={`${item.color} font-black underline italic truncate ml-4`}>{item.val}</span>
                  </div>
                ))}
              </div>

              <div className="mt-16 bg-black/40 p-6 border border-white/5">
                <div className="flex gap-1.5 items-end h-16">
                  {[...Array(30)].map((_, i) => (
                    <motion.div 
                      key={i}
                      animate={{ height: [8, Math.random() * 48 + 8, 8] }}
                      transition={{ repeat: Infinity, duration: 1 + Math.random(), delay: i * 0.03 }}
                      className="flex-1 bg-orange-600/40"
                    />
                  ))}
                </div>
                <div className="mt-4 flex justify-between text-[8px] font-bold text-gray-700 tracking-widest">
                  <span>FREQ_HZ</span>
                  <span>CPU_LOAD_32%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Grid: 01 to 08 - Specialized Style */}
      <section className="py-40 px-8 bg-[#030508] border-y border-white/[0.02]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-32 flex flex-col items-center">
            <h2 className="text-6xl font-black tracking-tighter uppercase mb-6 italic">Architecture</h2>
            <div className={`h-2 w-48 ${THEME.accentBg}`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-16 gap-y-28">
            {FEATURES.map((feature) => (
              <div key={feature.id} className="group cursor-crosshair">
                <div className="relative mb-10 inline-block">
                  <span className="absolute -top-12 -left-8 text-8xl font-black text-white/[0.02] leading-none group-hover:text-orange-600/[0.05] transition-colors">{feature.id}</span>
                  <div className={`relative z-10 w-16 h-16 border-2 ${THEME.border} flex items-center justify-center bg-[#0d1117] group-hover:border-orange-600 transition-colors shadow-2xl`}>
                    <feature.icon className={`w-8 h-8 ${THEME.accent}`} />
                  </div>
                </div>
                <h3 className="text-xl font-black mb-6 uppercase tracking-tighter italic">{feature.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed font-medium">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer: Specialized Industrial Style */}
      <footer className={`py-40 px-8 border-t ${THEME.border} bg-[#020406]`}>
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row justify-between items-start gap-32">
          <div className="max-w-xl">
            <div className="flex items-center gap-5 mb-12">
              <div className={`w-14 h-14 rounded-none bg-orange-600 flex items-center justify-center text-black shadow-2xl shadow-orange-600/20`}>
                <Cpu className="w-8 h-8" />
              </div>
              <span className={`text-4xl font-black tracking-tighter uppercase italic underline decoration-orange-600`}>SR TECH</span>
            </div>
            <p className="text-lg text-gray-500 leading-relaxed font-medium mb-16">
              The SR Bot Maker Hub is a fully asynchronous multi-bot management platform designed for the highest level of stability. Powered by the SR Advanced Deployment Protocol.
            </p>
            <div className="flex flex-wrap gap-12">
              <a href="#" className="text-[10px] font-black uppercase tracking-[0.3em] hover:text-orange-600 transition-colors">Documentation</a>
              <a href="#" className="text-[10px] font-black uppercase tracking-[0.3em] hover:text-orange-600 transition-colors">Mesh Protocols</a>
              <a href="#" className="text-[10px] font-black uppercase tracking-[0.3em] hover:text-orange-600 transition-colors">Uptime Report</a>
            </div>
          </div>

          <div className={`p-10 rounded-none ${THEME.card} border-2 border-orange-600/20 md:w-[450px] shadow-2xl relative overflow-hidden group`}>
            {/* Animated Scan Line */}
            <motion.div 
               animate={{ top: ['0%', '100%', '0%'] }}
               transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
               className="absolute left-0 w-full h-[2px] bg-orange-600/30 z-10 blur-sm"
            />
            
            <h4 className="text-[10px] font-bold text-gray-500 mb-10 uppercase tracking-[0.4em] italic border-b border-white/5 pb-4">Real-time Node Telemetry</h4>
            <div className="space-y-6 font-mono">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-gray-600 uppercase tracking-widest">Global_Load</span>
                <span className="text-white font-bold italic">NORMAL_32%</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-gray-600 uppercase tracking-widest">Active_Threads</span>
                <span className="text-white font-bold italic underline">1024_INSTANCES</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-gray-600 uppercase tracking-widest">Mesh_Security</span>
                <span className="text-green-500 font-bold italic uppercase">Encrypted_AES</span>
              </div>
              <div className="mt-12">
                <a 
                  href={hubUrl} 
                  target="_blank"
                  rel="noreferrer"
                  className={`w-full py-6 ${isOperational ? 'bg-orange-600 hover:brightness-110' : 'bg-gray-800 pointer-events-none'} text-black font-black text-xs uppercase tracking-[0.3em] flex items-center justify-center transition-all`}
                >
                  {isOperational ? 'Connect Node' : 'Waiting for API'}
                </a>
              </div>
            </div>
          </div>
        </div>
        
        <div className="max-w-7xl mx-auto mt-40 pt-16 border-t border-white/5 flex flex-col lg:flex-row justify-between items-center gap-10">
          <p className="text-[9px] font-mono text-gray-700 tracking-[0.3em] uppercase">Kernel_Build: 15102117223-PRODUCTION-V2.5</p>
          <div className="flex gap-16">
            <span className="text-[9px] font-mono text-gray-700 tracking-[0.3em] uppercase">© 2026 SR TECHNOLOGY LTD™.</span>
            <span className="text-[9px] font-mono text-gray-700 tracking-[0.3em] uppercase">Secure Mesh Protocol: Enabled</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
