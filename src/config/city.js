// One city configuration shared by map views and existing workspace labels.
// Incidents are never moved or constrained to this initial viewport.
export const city = {
  id:'karachi',name:'Karachi',timezone:'Asia/Karachi',
  center:[24.8607,67.0011],zoom:11,
  tileUrl:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',maxZoom:19,
  // Identify the real site to the tile provider even after the OAuth callback's
  // no-referrer document policy; never disclose callback queries or page paths.
  tileReferrerPolicy:'strict-origin',
  attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
