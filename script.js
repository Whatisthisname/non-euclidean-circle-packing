// ---------------------------------------------------------------------------
// 1) Import Rapier via CDN
// ---------------------------------------------------------------------------
import * as RAPIER from "https://cdn.skypack.dev/@dimforge/rapier2d-compat?min";

await RAPIER.init(); // Initialize the Rapier WASM module

// -------------------------------------------------------------------------
// 2) Basic Setup
// -------------------------------------------------------------------------
const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");

const INIT_SCALEFACTOR = 0.1
const INIT_ELLIPSES = 50

// We’ll keep a square domain [-1,1]x[-1,1], but the canvas is 800x800 by default.
// We’ll define transform helpers to go between simulation (world) coords -> screen coords.
function worldToScreen(x, y) {
    // Domain = [-1..1], so size = 2
    // Canvas size ~ 800 (in CSS pixels, can be different if resized).
    const w = canvas.width;
    const h = canvas.height;
    // Map [-1..1] -> [0..w or h], then center:
    const sx = (x + 1) * 0.5 * w;
    const sy = (1 - (y + 1) * 0.5) * h; // invert y to have +y up visually
    return [sx, sy];
}

// Convert a length in world coords to length in screen coords (for ellipse drawing).
// This is approximate if x-scaling != y-scaling, but we keep the domain square in the canvas.
function worldLengthToScreen(length) {
    return length * (canvas.width / 2);
}

// Store simulation parameters in a small config object
let config = {
    ellipseCount: INIT_ELLIPSES,
    scaleFactor: INIT_SCALEFACTOR,  // uniform scale for the ellipses
    ellipseSides: 8,  // polygon approximation resolution
};

// UI references
const ellipseCountSpan = document.getElementById("ellipseCountSpan");
const ellipseCountInput = document.getElementById("ellipseCountInput");
const ellipseCountInputSubmit = document.getElementById("ellipseCountInputSubmit");
const addEllipseBtn = document.getElementById("addEllipseBtn");
const removeEllipseBtn = document.getElementById("removeEllipseBtn");
const scaleUpBtn = document.getElementById("scaleUpBtn");
const scaleDownBtn = document.getElementById("scaleDownBtn");
const resetBtn = document.getElementById("resetBtn");

// -------------------------------------------------------------------------
// 3) Initialize Rapier World (2D)
// -------------------------------------------------------------------------
const gravity = { x: 0.0, y: 0.0 }; // no gravity
let world = new RAPIER.World(gravity);

// Because we will re-create bodies/colliders on reset, let's keep some init logic in a function
let bodies = [];
let colliders = [];
let walls = [];
let evaluations = [];

function setupWorld() {
    // Clear everything if re-initializing
    bodies = [];
    colliders = [];
    walls = [];
    world.free(); // Free the old world WASM memory
    world = new RAPIER.World(gravity);


    switch (selectMetric.value) {
        case "1":
        case "2":
            // Create bounding box as 4 static walls. Domain = [-1..1] => width=2, height=2
            // We’ll make thin rectangles around the perimeter:
            const thickness = 0.01;
            const halfSize = 1.0;

            // left wall
            {
                const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(-halfSize, 0);
                const rb = world.createRigidBody(rbDesc);
                const colDesc = RAPIER.ColliderDesc.cuboid(thickness, halfSize).setRestitution(0).setFriction(0);
                const collider = world.createCollider(colDesc, rb);
                walls.push({ rb, collider });
            }
            // right wall
            {
                const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(halfSize, 0);
                const rb = world.createRigidBody(rbDesc);
                const colDesc = RAPIER.ColliderDesc.cuboid(thickness, halfSize).setRestitution(0).setFriction(0);
                const collider = world.createCollider(colDesc, rb);
                walls.push({ rb, collider });
            }
            // bottom wall
            {
                const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -halfSize);
                const rb = world.createRigidBody(rbDesc);
                const colDesc = RAPIER.ColliderDesc.cuboid(halfSize, thickness).setRestitution(0).setFriction(0);
                const collider = world.createCollider(colDesc, rb);
                walls.push({ rb, collider });
            }
            // top wall
            {
                const rbDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, halfSize);
                const rb = world.createRigidBody(rbDesc);
                const colDesc = RAPIER.ColliderDesc.cuboid(halfSize, thickness).setRestitution(0).setFriction(0);
                const collider = world.createCollider(colDesc, rb);
                walls.push({ rb, collider });
            }
            break;

        case "3":
            // Create a hollow unit-disc as a static wall
            {
                const rbDesc = RAPIER.RigidBodyDesc.fixed();
                const rb = world.createRigidBody(rbDesc);
                // 3) Generate a circle of nSides points in local coords, then transform by the ellipse matrix
                const points = [];
                for (let i = 0; i < 50; i++) {
                    const angle = (2.0 * Math.PI * i) / 49;
                    // Unit circle
                    let cx = Math.cos(angle);
                    let cy = Math.sin(angle);
                    cx *= 0.9;
                    cy *= 0.9
                    points.push({ x: cx, y: -cy });
                }
                const vertArray = points.flatMap(p => [p.x, p.y]);
                const colDesc = RAPIER.ColliderDesc.polyline(vertArray).setRestitution(0).setFriction(0);
                const collider = world.createCollider(colDesc, rb);
                walls.push({ rb, collider });
            }
            break
    }

    // Create initial ellipses
    for (let i = 0; i < config.ellipseCount; i++) {
        createEllipseBody();
    }
}

// -------------------------------------------------------------------------
// 4) Create Ellipse RigidBody + Collider
// -------------------------------------------------------------------------
function createEllipseBody() {

    var x, y;
    switch (selectMetric.value) {
        case "1":
        case "2":
            // Random initial position within [-1..1]
            x = Math.random() * 2 - 1;
            y = Math.random() * 2 - 1;

            break;
        case "3":
            // Random initial position within unit disc
            const r = 0.9 * Math.sqrt(Math.random());
            const theta = Math.random() * 2 * Math.PI;
            x = r * Math.cos(theta);
            y = r * Math.sin(theta);
            break;
    }

    // Create dynamic body with locked rotation
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y)
        // We can lock rotation by using setEnabledRotations(false) in Rapier2D
        .lockRotations()
        .setCcdEnabled(true);

    const rb = world.createRigidBody(rbDesc);

    // Create a placeholder collider. We’ll set shape each frame based on matrix at that position,
    // but we need an initial shape. Let's just do a small circle to start.
    const colDesc = RAPIER.ColliderDesc.ball(0.1)
        .setDensity(1.0)
        .setRestitution(0.0)
        .setFriction(0.0);

    const collider = world.createCollider(colDesc, rb);
    bodies.push(rb);
    colliders.push(collider);
    evaluations.push(error_handing_metric_function(x, y));
}

// -------------------------------------------------------------------------
// 5) Compute Ellipse Matrix => polygon shape
// -------------------------------------------------------------------------
// Example matrix: M(x, y) = [[0.1 + x^2+y^2, 0], [0, 0.1 + x^2+y^2]]
// Or more generally M = Q * Lambda * Q^T for ellipse bounding x^T M x <= 1
// We'll approximate by generating a circle in local coords and applying sqrt(M^-1).
function default_metric_function(x, y) {
    // In your real code, M(x, y) might be more complex.
    return [
        [1.0, 0],
        [0, 3.0]
    ];
}

let metric_function = default_metric_function;


let error_handing_metric_function = function (x, y) {
    const matrix = metric_function(x, y);
    if (matrix[0][0] * matrix[1][1] - matrix[1][0] ** 2 < 1e-12) {
        console.error("Matrix is singular at (x, y) ", x, y, matrix);
        return [[1, 0], [0, 1]];
    }
    return matrix;
}




function approximateEllipsePolygon(body_idx, nSides) {
    const M = evaluations[body_idx];

    // 1) Eigen-decompose M to find Q and Lambda
    //    For 2x2, it's straightforward, but to keep it short, let's do a small helper:
    const { eigenvalues, eigenvectors } = eigenDecomposition2x2(M);

    // 2) The local scaling for the unit circle is scaleX = 1/sqrt(lambda1), scaleY = 1/sqrt(lambda2).
    const lam1 = eigenvalues[0];
    const lam2 = eigenvalues[1];
    // avoid division by zero just in case
    const scale1 = lam1 //> 1e-12 ? 1.0 / Math.sqrt(lam1) : 1e6;
    const scale2 = lam2 //> 1e-12 ? 1.0 / Math.sqrt(lam2) : 1e6;

    // 3) Generate a circle of nSides points in local coords, then transform by the ellipse matrix
    const points = [];
    for (let i = 0; i < nSides; i++) {
        const angle = (2.0 * Math.PI * i) / nSides;
        // Unit circle
        let cx = Math.cos(angle);
        let cy = Math.sin(angle);
        // Scale by Lambda^-1/2
        cx *= scale1 * 1.05;
        cy *= scale2 * 1.05;
        // Rotate by Q
        // Q is a 2x2 matrix. eigenvectors = [[vx1, vy1],[vx2, vy2]] for each eigen vector
        // We'll interpret eigenvectors as columns: Q=[v1, v2]
        const q11 = eigenvectors[0][0];
        const q21 = eigenvectors[1][0];
        const q12 = eigenvectors[0][1];
        const q22 = eigenvectors[1][1];

        const tx = q11 * cx + q12 * cy;
        const ty = q21 * cx + q22 * cy;
        // Scale by user config scaleFactor
        points.push({ x: tx * config.scaleFactor, y: -ty * config.scaleFactor });
    }
    return points;
}

function eigenDecomposition2x2(M) {
    const a = M[0][0];
    const b = M[0][1];
    const d = M[1][1];
    // invert matrix:

    // const denom = a * d - b * b;
    // M = [
    //     [d / denom, -b / denom],
    //     [-b / denom, a / denom]
    // ];


    // --- 1) Compute eigenvalues
    const trace = a + d;
    const det = a * d - b * b;
    const disc = Math.sqrt(Math.max((trace * trace) / 4 - det, 0));
    let lam1 = 0.5 * trace + disc;
    let lam2 = 0.5 * trace - disc;

    console.log("Eigenvalues")
    console.log(lam1)
    console.log(lam2)

    // --- 2) Solve for v1
    const M1 = [
        [a - lam1, b],
        [b, d - lam1]
    ];

    // a simple approach: pick v1 = (M1[1][0], -M1[0][0])
    let v1 = [M1[1][0], -M1[0][0]];
    let len1 = Math.hypot(v1[0], v1[1]);
    if (len1 < 1e-12) {
        // fallback if that row is effectively zero
        v1 = [1, 0];
    } else {
        v1 = [v1[0] / len1, v1[1] / len1];
    }

    // console.log("lengths")
    // console.log(Math.hypot(v1[0], v1[1]))
    // second eigenvalue will be orthogonal to v1
    let v2 = [v1[1], -v1[0]];
    console.log(Math.hypot(v2[0], v2[1]))

    // --- 4) Optionally fix overall orientation so that (v1, v2) 
    //     is a right-handed coordinate system:
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    if (cross < 0) {
        // console.log("Fixing orientation");
        v2 = [-v2[0], -v2[1]];
    }

    var obj = {
        eigenvalues: [lam1, lam2],
        eigenvectors: [v1, v2]
    };

    // console.log("Eigenvalues")
    console.log(obj.eigenvalues)
    // console.log("Eigenvectors")
    console.log(obj.eigenvectors)
    return obj;
}


// -------------------------------------------------------------------------
// 6) Simulation Loop & Dynamic Collider Updates
// -------------------------------------------------------------------------
function update() {
    // Step the Rapier simulation
    world.step();

    // For each body, re-compute the shape from M(x,y) at its current position,
    // remove old collider, create new one.

    for (let body_idx = 0; body_idx < bodies.length; body_idx++) {
        const rb = bodies[body_idx];
        const col = colliders[body_idx];

        var real_col = world.getCollider(col.handle)
        // remove old collider
        world.removeCollider(real_col, true); // do not wake bodies

        // get new shape
        const t = rb.translation(); // {x, y}

        switch (selectMetric.value) {
            case "1":
            case "2":
                // check if the body is outside the bounding box
                if (t.x < -1 || t.x > 1 || t.y < -1 || t.y > 1) {
                    // reset position
                    rb.setTranslation(0, 0);
                }
                break
            case "3":
                // check if the body is outside the unit disc
                if (t.x ** 2 + t.y ** 2 > 0.9) {
                    rb.setTranslation(0.001, 0.001);
                }
                break
        }

        const metric = error_handing_metric_function(t.x, t.y);
        evaluations[body_idx] = metric;

        const points = approximateEllipsePolygon(body_idx, config.ellipseSides);

        // Now create a new polygon collider. The Rapier constructor expects an array of [x,y].
        const vertArray = points.flatMap(p => [p.x, p.y]);

        const colDesc = RAPIER.ColliderDesc.convexHull(vertArray)
            .setDensity(1.0)
            .setRestitution(0.0)
            .setFriction(0.0);

        const newCol = world.createCollider(colDesc, rb);
        colliders[body_idx] = newCol;
    }

    draw();
    requestAnimationFrame(update);
}

// -------------------------------------------------------------------------
// 7) Drawing
// -------------------------------------------------------------------------
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 5;


    switch (selectMetric.value) {
        case "1":
        case "2":
            // Draw bounding box
            // corners: [-1,-1], [-1,1], [1,1], [1,-1]
            let tl = worldToScreen(-1, 1);
            let tr = worldToScreen(1, 1);
            let br = worldToScreen(1, -1);
            let bl = worldToScreen(-1, -1);
            ctx.beginPath();
            ctx.moveTo(tl[0], tl[1]);
            ctx.lineTo(tr[0], tr[1]);
            ctx.lineTo(br[0], br[1]);
            ctx.lineTo(bl[0], bl[1]);
            ctx.closePath();
            ctx.stroke();
            break;
        case "3":
            // Draw 0.9 unit disc
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, 0.9 * canvas.width / 2, 0, 2 * Math.PI);
            ctx.stroke();
            break;
    }

    // Draw each ellipse in its "actual" shape. We'll do an eigen-decomposition for drawing
    // but that’s the same used in approximateEllipsePolygon. This time we draw the smooth ellipse.
    ctx.fillStyle = "rgba(100, 150, 220, 1.0)";
    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;

    // for (let body_idx = 0; body_idx < bodies.length; body_idx++) {
    //     const rb = bodies[body_idx];
    //     const { x, y } = rb.translation();

    //     // get ellipse matrix
    //     const M = evaluations[body_idx];
    //     const { eigenvalues, eigenvectors } = eigenDecomposition2x2(M);

    //     // principal axis lengths
    //     const lam1 = eigenvalues[0];
    //     const lam2 = eigenvalues[1];
    //     const a = lam1 > 1e-12 ? 1 / Math.sqrt(lam1) : 1e6;
    //     const b = lam2 > 1e-12 ? 1 / Math.sqrt(lam2) : 1e6;
    //     if (lam1 < 0 || lam2 < 0) {
    //         console.error("Invalid ellipse shape", a, b, M);
    //     }
    //     const angle = Math.PI / 2 - Math.atan2(eigenvectors[1][1], eigenvectors[1][0]);
    //     // or some consistent orientation from the eigenvectors

    //     // incorporate scaleFactor
    //     const ra = a * config.scaleFactor;
    //     const rb_ = b * config.scaleFactor;

    //     // draw on canvas
    //     ctx.save();
    //     // translate
    //     const [sx, sy] = worldToScreen(x, y);
    //     ctx.translate(sx, sy);
    //     // rotate
    //     ctx.rotate(angle);
    //     // scale from world -> screen
    //     ctx.scale(worldLengthToScreen(ra), worldLengthToScreen(rb_));
    //     // draw ellipse
    //     ctx.beginPath();
    //     ctx.ellipse(0, 0, 1, 1, 0, 0, 2 * Math.PI);
    //     ctx.fill();
    //     ctx.restore();
    //     ctx.stroke();
    // }

    ctx.strokeStyle = "black";

    // draw all colliders:
    for (let body_idx = 0; body_idx < bodies.length; body_idx++) {
        const t = bodies[body_idx].translation(); // {x, y}
        const points = approximateEllipsePolygon(body_idx, config.ellipseSides);

        // Now create a new polygon collider. The Rapier constructor expects an array of [x,y].
        const vertArray = points.map(p => [t.x + p.x, t.y + p.y]);
        for (let j = 0; j < vertArray.length; j++) {
            const p1 = worldToScreen(vertArray[j][0], vertArray[j][1]);
            const p2 = worldToScreen(vertArray[(j + 1) % vertArray.length][0], vertArray[(j + 1) % vertArray.length][1]);
            ctx.beginPath();
            ctx.moveTo(p1[0], p1[1]);
            ctx.lineTo(p2[0], p2[1]);
            ctx.stroke();
        }
    }
}

// -------------------------------------------------------------------------
// 8) UI Controls
// -------------------------------------------------------------------------
function refreshUI() {
    ellipseCountSpan.textContent = `Ellipses: ${config.ellipseCount}`;
}

function buildUserMatrixFunction(m11Expr, m12Expr, m22Expr) {
    // Safely create a new Function (be aware of security implications in real usage).
    // Example: "return [[0.1 + x*x + y*y, 0], [0, 0.1 + x*x + y*y]];"
    const code = `
      return [
        [ ${m11Expr}, ${m12Expr} ],
        [ ${m12Expr}, ${m22Expr} ]
      ];
    `;
    return new Function("x", "y", code);
}

function updateMatrixPreview(m11Expr, m12Expr, m22Expr) {
    const previewDiv = document.getElementById("matrixPreview");
    // Build a LaTeX string:
    // For instance: \(\begin{pmatrix} 0.1+x^2+y^2 & 0 \\ 0 & 0.1+x^2+y^2 \end{pmatrix}\)

    function add_cdot(expr) {
        return expr.replace(/([a-z0-9]+) *\* *([a-z0-9]+)/g, "$1 \\cdot $2");
    }

    m11Expr = add_cdot(m11Expr);
    m12Expr = add_cdot(m12Expr);
    m22Expr = add_cdot(m22Expr);

    const latex = `\\[
    g(x, y) = \\begin{pmatrix}
        ${m11Expr} & ${m12Expr} \\\\
        ${m12Expr} & ${m22Expr}
    \\end{pmatrix}
    \\]`;

    previewDiv.textContent = ""; // Clear
    previewDiv.insertAdjacentHTML("beforeend", latex);

    // Ask MathJax to typeset it
    if (window.MathJax && window.MathJax.typesetPromise) {
        MathJax.typesetPromise([previewDiv]).catch((err) => console.log(err.message));
    }
}

const selectMetric = document.getElementById("metric");
const m11Input = document.getElementById("m11Input");
const m12Input = document.getElementById("m12Input");
const m22Input = document.getElementById("m22Input");
const updateMatrixBtn = document.getElementById("updateMatrixBtn");



function RebuildMatrixFunc() {
    try {
        userMatrixFunc = buildUserMatrixFunction(
            m11Input.value,
            m12Input.value,
            m22Input.value
        );
        // If parse is successful, store/replace your getEllipseMatrix logic

        // e.g. in your existing code, if you have a function getEllipseMatrix(x, y), 
        // you can override it to:
        metric_function = function (x, y) {
            return userMatrixFunc(x, y);
        };

        // Or if you store that in a config object:
        // config.getEllipseMatrix = userMatrixFunc;

        console.log("Matrix function updated successfully");
    } catch (err) {
        console.error("Failed to build matrix function:", err);
        // Optionally show an error message to the user
    }
}

// Store a reference in config, or however you're retrieving M(x,y)
let userMatrixFunc = (x, y) => [[0.1 + x * x + y * y, 0], [0, 0.1 + x * x + y * y]];

updateMatrixPreview(m11Input.value, m12Input.value, m22Input.value);
// RebuildMatrixFunc();


updateMatrixBtn.addEventListener("click", () => {
    // 1) Update LaTeX preview
    updateMatrixPreview(m11Input.value, m12Input.value, m22Input.value);

    // 2) Rebuild the matrix function
    RebuildMatrixFunc();
});



addEllipseBtn.onclick = () => {
    config.ellipseCount++;
    createEllipseBody();
    refreshUI();
};

ellipseCountInputSubmit.onclick = () => {

    const value = parseInt(ellipseCountInput.value);
    while (config.ellipseCount < value) {
        config.ellipseCount++;
        createEllipseBody();
    }
    while (config.ellipseCount > value) {
        config.ellipseCount--;
        // remove last ellipse from arrays
        const rb = bodies.pop();
        const col = colliders.pop();
        evaluations.pop();
        world.removeCollider(col);
        world.removeRigidBody(rb);
    }
};

removeEllipseBtn.onclick = () => {
    if (config.ellipseCount > 0) {
        config.ellipseCount--;
        // remove last ellipse from arrays
        const rb = bodies.pop();
        const col = colliders.pop();
        evaluations.pop();
        world.removeCollider(col);
        world.removeRigidBody(rb);
        refreshUI();
    }
};

scaleUpBtn.onclick = () => {
    config.scaleFactor *= 1.1;
};

scaleDownBtn.onclick = () => {
    config.scaleFactor *= 0.9;
};



resetBtn.onclick = () => {
    config.ellipseCount = INIT_ELLIPSES;
    config.scaleFactor = INIT_SCALEFACTOR;
    setupWorld();
    refreshUI();
};

selectMetric.onchange = () => {
    const selected = selectMetric.value;
    console.log("Selected metric:", selected);
    select_preset(selected);
};

function select_preset(selected) {
    if (selected == 1) {
        m11Input.value = projected_bell_m11;
        m12Input.value = projected_bell_m12;
        m22Input.value = projected_bell_m22;
        updateMatrixPreview(m11Input.value, m12Input.value, m22Input.value);
        RebuildMatrixFunc();
        setupWorld();
    } else if (selected == 2) {
        m11Input.value = projected_quadratic_m11;
        m12Input.value = projected_quadratic_m12;
        m22Input.value = projected_quadratic_m22;
        updateMatrixPreview(m11Input.value, m12Input.value, m22Input.value);
        RebuildMatrixFunc();
        setupWorld();
    }
    else if (selected == 3) {
        m11Input.value = hyperbolic_m11;
        m12Input.value = hyperbolic_m12;
        m22Input.value = hyperbolic_m22;
        updateMatrixPreview(m11Input.value, m12Input.value, m22Input.value);
        RebuildMatrixFunc();
        setupWorld();
    }
}

const projected_bell_m11 = "(-55.279225*(0.899986550100874*x - y)**2 - Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2))*Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2)/(37433.1730781839*(0.899986550100874*x - y)**2*(x - 0.25714000245942*y)**2 - (55.279225*(0.899986550100874*x - y)**2 + Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2))*(677.16530176*(x - 0.25714000245942*y)**2 + Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2)))"
const projected_bell_m12 = "-0.25*(13.3828*x - 14.87*y)*(52.0448*x - 13.3828*y)*Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2)/(37433.1730781839*(0.899986550100874*x - y)**2*(x - 0.25714000245942*y)**2 - (55.279225*(0.899986550100874*x - y)**2 + Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2))*(677.16530176*(x - 0.25714000245942*y)**2 + Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2)))"
const projected_bell_m22 = "(-677.16530176*(x - 0.25714000245942*y)**2 - Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2))*Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2)/(37433.1730781839*(0.899986550100874*x - y)**2*(x - 0.25714000245942*y)**2 - (55.279225*(0.899986550100874*x - y)**2 + Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2))*(677.16530176*(x - 0.25714000245942*y)**2 + Math.exp(52.0448*x**2 - 26.7656*x*y + 14.87*y**2)))"

const projected_quadratic_m11 = "(0.25*y**2 + 1.0)/(1.0*x**2 + 0.25*y**2 + 1.0)"
const projected_quadratic_m12 = "-0.5*x*y/(1.0*x**2 + 0.25*y**2 + 1.0)"
const projected_quadratic_m22 = "1.0*(x**2 + 1.0)/(1.0*x**2 + 0.25*y**2 + 1.0)"

const hyperbolic_m11 = "(-(x**2) - (y**2) + 1.0)"
const hyperbolic_m12 = "0.0"
const hyperbolic_m22 = "(-(x**2) - (y**2) + 1.0)"


// -------------------------------------------------------------------------
// Kick it off
// -------------------------------------------------------------------------
select_preset(1);
setupWorld();
refreshUI();
draw()
requestAnimationFrame(update);