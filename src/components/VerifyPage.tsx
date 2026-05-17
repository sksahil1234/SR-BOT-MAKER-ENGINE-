/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, 
  Fingerprint, 
  Activity, 
  Lock, 
  ShieldAlert,
  Bot
} from 'lucide-react';

export default function VerifyPage() {
  const [step, setStep] = useState<'scan' | 'verifying' | 'success' | 'fail'>('scan');
  const [progress, setProgress] = useState(0);
  const [reason, setReason] = useState("");

  const params = new URLSearchParams(window.location.search);
  const nodeId = params.get('nodeId');
  const userId = params.get('userId');
  const refId = params.get('ref');

  useEffect(() => {
    if (step === 'verifying') {
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            handleFinalize();
            return 100;
          }
          return prev + Math.random() * 5;
        });
      }, 100);
      return () => clearInterval(interval);
    }
  }, [step]);

  const handleFinalize = async () => {
    try {
      const res = await fetch('/api/verify-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, userId, ref: refId })
      });
      const data = await res.json();
      if (data.success) {
        setStep('success');
      } else {
        setStep('fail');
        setReason(data.reason || "Duplicate device detected.");
      }
    } catch (e) {
      setStep('fail');
      setReason("Uplink lost. Try again.");
    }
  };

  const startScan = () => {
    setStep('verifying');
  };

  return (
    <div className="min-h-screen bg-[#05070a] text-white flex flex-col items-center justify-center p-6 font-sans">
      <AnimatePresence mode="wait">
        {step === 'scan' && (
          <motion.div 
            key="scan"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="flex flex-col items-center text-center space-y-8"
          >
            <div className="relative">
              <div className="w-40 h-40 rounded-full border-4 border-orange-600/20 flex items-center justify-center p-8 bg-orange-600/5">
                <Fingerprint className="w-full h-full text-orange-600 animate-pulse" />
              </div>
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 border-t-4 border-orange-600 rounded-full"
              />
            </div>
            
            <div className="space-y-4">
              <h1 className="text-3xl font-black tracking-tighter italic uppercase">Security Scan</h1>
              <p className="text-gray-500 max-w-xs text-sm">Initiate secure handshake to verify this device within SR Mesh.</p>
            </div>

            <button 
              onClick={startScan}
              className="px-12 py-5 bg-orange-600 text-black font-black uppercase tracking-[0.2em] shadow-[0_0_30px_rgba(234,88,12,0.3)] hover:brightness-110 active:scale-95 transition-all"
            >
              Start Handshake
            </button>
          </motion.div>
        )}

        {step === 'verifying' && (
          <motion.div 
            key="verifying"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center w-full max-w-sm"
          >
            <div className="w-full h-1 bg-white/5 mb-12 relative overflow-hidden">
              <motion.div 
                className="absolute left-0 top-0 h-full bg-orange-600"
                style={{ width: `${progress}%` }}
              />
            </div>
            
            <div className="flex flex-col items-center space-y-8">
              <div className="relative">
                 <Lock className="w-16 h-16 text-orange-600 animate-bounce" />
              </div>
              <span className="text-[10px] font-mono tracking-[0.5em] text-gray-400 uppercase">Verifying Device Integrity... {Math.floor(progress)}%</span>
              
              <div className="grid grid-cols-2 gap-4 w-full opacity-50">
                <div className="p-3 border border-white/5 bg-white/[0.02] flex items-center gap-3">
                  <Activity className="w-4 h-4 text-orange-600" />
                  <span className="text-[8px] font-mono">DPI_SCAN: RUN</span>
                </div>
                <div className="p-3 border border-white/5 bg-white/[0.02] flex items-center gap-3">
                  <Lock className="w-4 h-4 text-orange-600" />
                  <span className="text-[8px] font-mono">ENCRYPT: OK</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {step === 'success' && (
          <motion.div 
            key="success"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center text-center space-y-8"
          >
            <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center">
              <ShieldCheck className="w-12 h-12 text-green-500" />
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-black italic uppercase">Verified Successfully</h2>
              <p className="text-gray-500 text-sm">Your device has been authenticated. You can now return to the bot and click "Claim" or re-start it.</p>
            </div>
            <button 
              onClick={() => {
                 const tg = (window as any).Telegram?.WebApp;
                 if (tg) tg.close();
                 else window.close();
              }}
              className="px-10 py-4 bg-green-600 text-black font-black uppercase tracking-widest"
            >
              Continue to Bot
            </button>
          </motion.div>
        )}

        {step === 'fail' && (
          <motion.div 
            key="fail"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center text-center space-y-8"
          >
            <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center">
              <ShieldAlert className="w-12 h-12 text-red-500" />
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-black italic uppercase">Verification Failed</h2>
              <p className="text-red-500/70 text-sm font-bold uppercase tracking-widest">{reason}</p>
              <p className="text-gray-500 text-xs">Our system detected a security violation. Multiple accounts from the same hardware are not permitted.</p>
            </div>
            <button 
              onClick={() => setStep('scan')}
              className="px-8 py-3 bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest"
            >
              Try Again
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-12 flex items-center gap-3 opacity-20">
        <Bot className="w-4 h-4" />
        <span className="text-[8px] font-mono uppercase tracking-[0.4em]">SR TECHNOLOGY LTD™ SECURITY MESH</span>
      </div>
    </div>
  );
}
