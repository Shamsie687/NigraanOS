import Brand from './Brand';
import {navigation} from '../data/mockData';
const primary=[['Dashboard','◫','Command Center'],['Live Map','◎','Live Map'],['Citizen Reports','▧','Incidents'],['Urgent Operations','!','Urgent Operations'],['Analytics','▥','Analytics'],['Nigraan AI','✧','Nigraan AI'],['Nigraan Agent','◎','Nigraan Agent'],['Settings','⚙','Settings']];
const reports=navigation.filter(item=>item[2]&&item[2]!=='citizen');
export default function Sidebar({active,onNavigate,onExit}) {
  return <aside className="sidebar"><div className="sidebar-header"><Brand/></div>
    <div className="sidebar-caption eyebrow">OPERATIONS WORKSPACE</div>
    <nav className="nav-menu" aria-label="Operations navigation">
      {primary.map(([key,symbol,label])=><button key={key} className={'nav-item '+(active===key?'active':'')} onClick={()=>onNavigate(key)}><span>{symbol}</span>{label}</button>)}
      <details className="report-category-nav" open={reports.some(([key])=>key===active)}><summary>Report categories</summary>
        {reports.map(([key,symbol])=><button key={key} className={'nav-item '+(active===key?'active':'')} onClick={()=>onNavigate(key)}><span>{symbol}</span>{key==='Flood Risk'?'Flood reports':key==='Road Conditions'?'Road damage reports':key+' reports'}</button>)}
      </details>
    </nav>
    <div className="sidebar-bottom"><button className="nav-item" onClick={onExit}><span>↗</span>Sign out</button></div>
    <div className="sidebar-foot">AUTHORIZED CITY OPERATIONS</div>
  </aside>;
}
