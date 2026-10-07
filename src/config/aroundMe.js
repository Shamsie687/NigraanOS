// Approved V1 application coverage, not a legal/administrative boundary.
// Keep synchronized with migration 013's private nigraan_around_me_config().
export const coverage=Object.freeze({south:24.70,north:25.30,west:66.80,east:67.60,step:0.02});
export const gridRows=Math.ceil((coverage.north-coverage.south)/coverage.step-1e-8);
export const gridColumns=Math.ceil((coverage.east-coverage.west)/coverage.step-1e-8);
