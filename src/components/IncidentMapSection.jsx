import {Component,lazy,Suspense} from 'react';
const IncidentMap=lazy(()=>import('./IncidentMap'));
class MapBoundary extends Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    if(this.state.failed)return <section className="panel map-load-fallback"><h3>Map unavailable</h3><p>Reload this page to retry the map. Real incident lists and workflow remain available.</p></section>;
    return this.props.children;
  }
}
export default function IncidentMapSection(props) {
  return <MapBoundary><Suspense fallback={<section className="panel map-load-fallback" role="status">Loading interactive city map…</section>}><IncidentMap {...props}/></Suspense></MapBoundary>;
}
