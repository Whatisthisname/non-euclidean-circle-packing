var scene, camera, renderer, controls, viewport, canvas;

canvas = document.getElementById('3d-canvas');

const resolutionFactor = 3

function init() {
    // Create the scene and set the camera
    scene = new THREE.Scene();
    // load image from url and set to background:
    const loader = new THREE.TextureLoader();

    viewport = document.getElementById('grid-3d-viewport');

    loader.load("https://static.vecteezy.com/system/resources/previews/003/659/551/original/abstract-black-and-white-grid-striped-geometric-seamless-pattern-illustration-free-vector.jpg", function (texture) {

        // set image to repeat instead of stretch
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        const scale = 5;
        const aspect = viewport.offsetWidth / viewport.offsetHeight;
        texture.repeat.set(scale * aspect, scale);

        // set a white background:
        scene.background = new THREE.Color(0xffffff);
        // scene.background = texture;
    });


    camera = new THREE.PerspectiveCamera(75, viewport.offsetWidth / viewport.offsetHeight, 0.01, 1000);
    camera.position.x = 0;
    camera.position.y = 5;
    camera.position.z = -2.5;
    // camera = new THREE.OrthographicCamera(-viewport.offsetWidth / viewport.offsetHeight, viewport.offsetWidth / viewport.offsetHeight, 1, -1, 0.01, 20);
    // camera.position.x = 0;
    // camera.position.y = 5;
    // camera.position.z = -2.5;

    // Set up the WebGL renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(viewport.offsetWidth * resolutionFactor, viewport.offsetHeight * resolutionFactor);
    document.body.appendChild(renderer.domElement);
    canvas.style.width = viewport.offsetWidth + 'px';
    canvas.style.height = viewport.offsetHeight + 'px';
    viewport.appendChild(renderer.domElement);

    // Add OrbitControls to allow interactive camera manipulation

    controls = new THREE.OrbitControls(camera, renderer.domElement);

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start the animation loop
    animate();
}

var embedding_function;

const selectMesh = document.getElementById("mesh");

selectMesh.onchange = () => {
    const selected = selectMesh.value;
    console.log("Selected mesh:", selected);
    select_mesh(selected);
};


function select_mesh(selected) {
    if (selected == 1) {
        const mat = [[13.0112, -3.3457], [-3.3457, 3.7175]];
        embedding_function = function map_xy_to_xyz(x, y) {
            return [x, y, Math.exp(-1 * (mat[0][0] * x ** 2 + 2 * mat[0][1] * x * y + mat[1][1] * y ** 2)) ** 2];
        }
    } else if (selected == 2) {
        embedding_function = function map_xy_to_xyz(x, y) {
            return [x, y, -1 * x ** 2 - y ** 2];
        }
    }
    else if (selected == 3) {
        embedding_function = function map_xy_to_xyz(x, y) {
            return [x, y, 0];
        }
    }
    else if (selected == 4) {
        embedding_function = function map_xy_to_xyz(x, y) {
            return [2 * x, y, 0];
        }
    }
    else if (selected == 5) {
        embedding_function = function map_xy_to_xyz(x, y) {
            return [x, y, -1 * x ** 2 + y ** 2];
        }
    }
}

select_mesh(1);

function build_plane_mesh() {
    // Remove existing objects from the scene
    while (scene.children.length > 0) {
        scene.remove(scene.children[0]);
    }

    // Create geometry
    const geometry = new THREE.PlaneGeometry(2, 2, 100, 100);

    const positionAttribute = geometry.getAttribute('position');
    const uvAttribute = geometry.getAttribute('uv');
    const vertex = new THREE.Vector3();
    const uv = new THREE.Vector2();

    for (let i = 0; i < positionAttribute.count; i++) {

        vertex.fromBufferAttribute(positionAttribute, i); // read vertex
        uv.fromBufferAttribute(uvAttribute, i); // read uv

        // do something with vertex
        uvAttribute.setXY(i, 0.5 + 0.5 * vertex.x, 0.5 + 0.5 * vertex.y); // write uv back
        const [x, y, z] = embedding_function(vertex.x, vertex.y);
        positionAttribute.setXYZ(i, -x, z, y); // write coordinates back
    }


    const canvasTexture = new THREE.CanvasTexture(document.getElementById('2d-canvas'), THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.LinearFilter);

    // Material with emissive base color
    const meshMaterial = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        map: canvasTexture,
        // alphaMap: canvasTexture,
    });

    // Create and add mesh
    const mesh = new THREE.Mesh(geometry, meshMaterial);
    scene.add(mesh);

    // Wireframe
    // const wireframe = new THREE.WireframeGeometry(geometry);
    // const line = new THREE.LineSegments(wireframe);
    // line.material.color.setHex(0x000000);
    // line.material.opacity = 0.25;
    // line.material.transparent = true;
    // scene.add(line);
}



function loadMesh(meshDataParam) {
    meshData = meshDataParam; // Store meshData globally to access color profiles later

    // Remove existing objects from the scene
    while (scene.children.length > 0) {
        scene.remove(scene.children[0]);
    }

    // Create geometry
    meshGeometry = new THREE.BufferGeometry();

    // Get the axis-aligned bounding box (AABB) of the mesh, and then center the mesh by translating AND scaling
    const aabb = new THREE.Box3();
    aabb.setFromPoints(meshData.vertices.map(v => new THREE.Vector3(...v)));
    const center = aabb.getCenter(new THREE.Vector3());
    const size = aabb.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 1 / maxDim;
    const offset = center.clone().multiplyScalar(-1);

    // Translate and scale vertices
    const verticesNormalized = meshData.vertices.map(v => {
        // return v
        const vec = new THREE.Vector3(...v);
        vec.add(offset).multiplyScalar(scale);
        return vec.toArray();
    });

    // Set normalized vertices
    meshGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verticesNormalized.flat()), 3));

    // Vertices
    // const vertices = new Float32Array(meshData.vertices.flat());
    // meshGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    // Faces
    const indices = new Uint32Array(meshData.faces.flat());
    meshGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // // Initial color profile (first one available)
    // const initialProfileName = Object.keys(meshData.colorProfiles)[0];
    // currentProfileName = initialProfileName;

    // Create color profile buttons and sliders
    // createColorProfileControls();

    // Apply initial color profile
    // applyColorProfile(initialProfileName);

    const canvasTexture = new THREE.CanvasTexture(document.getElementById('2d-canvas'));
    console.log(canvasTexture)

    // Material with vertex colors and lig
    meshMaterial = new THREE.MeshBasicMaterial({
        // vertexColors: false,
        // flatShading: true,
        side: THREE.DoubleSide,
        // polygonOffset: true,
        // polygonOffsetFactor: 1, // positive value pushes polygon further away
        // polygonOffsetUnits: 1,
        map: canvasTexture
    });
    // meshMaterial = new THREE.MeshPhongMaterial({
    //     vertexColors: false,
    //     flatShading: true,
    //     // light blue emissive color
    //     emissive: 0x0000ff,
    //     side: THREE.DoubleSide,
    //     polygonOffset: true,
    //     polygonOffsetFactor: 1, // positive value pushes polygon further away
    //     polygonOffsetUnits: 1
    // });

    // Create and add mesh
    mesh = new THREE.Mesh(meshGeometry, meshMaterial);
    scene.add(mesh);

    // Add a strong white light to the scene
    // const light = new THREE.DirectionalLight(0xffffff, 0.6);
    // light.position.set(0.3, 2, 0);
    // scene.add(light);

    // Wireframe
    // const wireframe = new THREE.WireframeGeometry(meshGeometry);
    // const line = new THREE.LineSegments(wireframe);
    // line.material.color.setHex(0x000000);
    // line.material.opacity = 0.25;
    // line.material.transparent = true;
    // scene.add(line);
}

function animate() {



    requestAnimationFrame(animate);
    build_plane_mesh();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = viewport.offsetWidth / viewport.offsetHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewport.offsetWidth, viewport.offsetHeight);
}

init();
build_plane_mesh();