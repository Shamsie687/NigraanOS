import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { default: Progress } = await server.ssrLoadModule(
    "/src/components/ReportProgress.jsx",
  );
  for (const status of [
    "reported",
    "acknowledged",
    "assigned",
    "in_progress",
    "resolved",
  ]) {
    const html = renderToString(React.createElement(Progress, { status }));
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
    assert.ok(html.includes("Earlier transition times are not recorded here."));
    assert.ok(html.includes("Future stage") || status === "resolved");
  }
  const unknown = renderToString(
    React.createElement(Progress, { status: "legacy" }),
  );
  assert.ok(unknown.includes("unavailable"));
  assert.ok(!unknown.includes("aria-current"));
  const { default: Camera } = await server.ssrLoadModule(
    "/src/components/PhotoCamera.jsx",
  );
  const camera = renderToString(
    React.createElement(Camera, { onUse() {}, onClose() {} }),
  );
  for (const value of [
    'role="dialog"',
    'aria-modal="true"',
    "Enable camera",
    "Cancel",
    "Use Upload Photo instead",
    "Video only",
  ])
    assert.ok(camera.includes(value));
  assert.ok(!camera.includes("<video"));
  const { default: Form } = await server.ssrLoadModule(
    "/src/components/IncidentForm.jsx",
  );
  const form = renderToString(
    React.createElement(Form, { userId: "test", onSaved() {}, onBusy() {} }),
  );
  assert.ok(form.includes("Take Photo"));
  assert.ok(form.includes("Upload Photo"));
  assert.equal((form.match(/type="file"/g) || []).length, 1);
  assert.ok(form.includes("GPS + photo required"));
  assert.ok(form.includes("Voice report"));
  const { default: Feed } = await server.ssrLoadModule('/src/components/ReportFeed.jsx');
  const { default: Detail } = await server.ssrLoadModule('/src/components/CitizenReportDetail.jsx');
  for (const [status, action] of [['reported','Edit Report'],['acknowledged','Add Update'],['assigned','Add Update'],['in_progress','Add Update'],['resolved',null]]) {
    const report={id:'test-report',title:'Test report',description:'Test description',category:'traffic',status,reported_at:'2026-10-07T00:00:00Z',area:'Test area',latitude:0,longitude:0};
    const card=renderToString(React.createElement(Feed,{citizen:true,onSelect(){},feed:{reports:[report],total:1,loading:false,error:'',refresh(){}}}));
    assert.equal((card.match(/>View Details<\/button>/g)||[]).length,1,status+' has exactly one detail action');
    assert.ok(card.includes('View evidence'),status+' retains evidence access');
    assert.ok(card.includes('class="evidence-actions"'),status+' uses wrapping action layout');
    if(action)assert.ok(card.includes('>'+action+'</button>'),status+' retains '+action);
    else {assert.ok(!card.includes('Edit Report'));assert.ok(!card.includes('Add Update'));}
    const detail=renderToString(React.createElement(Detail,{report,userId:'test-user',onClose(){},onChanged(){},onBusy(){}}));
    assert.ok(detail.includes('Report workflow progress'));
    if(status==='resolved'){assert.ok(detail.includes('Completed · Read-only'));assert.ok(!detail.includes('>Edit Report</button>'));assert.ok(!detail.includes('>Add Update</button>'));}
    const operations=renderToString(React.createElement(Feed,{onSelect(){},feed:{reports:[report],total:1,loading:false,error:'',refresh(){}}}));
    assert.ok(operations.includes('View incident details'));assert.ok(!operations.includes('>View Details</button>'));assert.ok(!operations.includes('>Edit Report</button>'));assert.ok(!operations.includes('>Add Update</button>'));
  }
  console.log("Citizen camera/progress render checks passed.");
} finally {
  await server.close();
}
