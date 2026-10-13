import {remainingAccessMs} from '../services/judgeAccess';
import {useEffect,useState} from 'react';
export default function JudgeCountdown({access}) {
  const [,tick]=useState(0);
  useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),1000);return()=>clearInterval(timer);},[]);
  if(!access||access.permanent)return null;
  const seconds=Math.ceil(remainingAccessMs(access)/1000);
  return <p className="verification-note" role="status">Temporary Operations · {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')} remaining · Citizen access continues afterward</p>;
}
