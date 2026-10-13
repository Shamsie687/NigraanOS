export function remainingAccessMs(access,now=performance.now()) {
  if(!access||access.permanent)return null;
  if(!access.allowed||access.status!=='active')return 0;
  const remaining=Date.parse(access.expires_at)-Date.parse(access.server_now)-(now-access.receivedAt);
  return Number.isFinite(remaining)?Math.max(0,remaining):0;
}
