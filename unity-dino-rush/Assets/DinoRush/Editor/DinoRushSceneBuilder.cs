// One-click scene setup: menu "DinoRush > 1. 씬 자동 만들기".
// Builds terrain (from the web version's heightmap, auto-painted), water, sun, fog,
// the coaster cars with the rider camera, and all managers. Run it again any time;
// it replaces what it created before.
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace DinoRush.EditorTools
{
    public static class DinoRushSceneBuilder
    {
        const string Data = "Assets/DinoRush/Data/";
        const string Gen = "Assets/DinoRush/Generated/";

        [Serializable] class TerrainMeta { public float size; public int resolution; public float minHeight, maxHeight, waterLevel; }

        [MenuItem("DinoRush/1. 씬 자동 만들기 (Build Scene)")]
        public static void Build()
        {
            if (!Directory.Exists(Gen)) Directory.CreateDirectory(Gen);
            var trackJson = AssetDatabase.LoadAssetAtPath<TextAsset>(Data + "track.json");
            var metaJson = AssetDatabase.LoadAssetAtPath<TextAsset>(Data + "terrain.json");
            var heightBytes = AssetDatabase.LoadAssetAtPath<TextAsset>(Data + "terrain_height.bytes");
            if (!trackJson || !metaJson || !heightBytes) { EditorUtility.DisplayDialog("DinoRush", "Assets/DinoRush/Data 폴더에 track.json, terrain.json, terrain_height.bytes 가 있어야 해요.", "확인"); return; }

            var old = GameObject.Find("DinoRush World");
            if (old) UnityEngine.Object.DestroyImmediate(old);
            var world = new GameObject("DinoRush World");

            // ---------- terrain ----------
            var meta = JsonUtility.FromJson<TerrainMeta>(metaJson.text);
            var td = new TerrainData { heightmapResolution = meta.resolution };
            td.size = new Vector3(meta.size, meta.maxHeight - meta.minHeight, meta.size);
            var raw = heightBytes.bytes;
            int R = meta.resolution;
            var h = new float[R, R];
            for (int z = 0; z < R; z++)
                for (int x = 0; x < R; x++)
                    h[z, x] = BitConverter.ToUInt16(raw, (z * R + x) * 2) / 65535f;
            td.SetHeights(0, 0, h);
            PaintTerrain(td, meta);
            AssetDatabase.CreateAsset(td, Gen + "DinoTerrain.asset");
            var terrainGo = Terrain.CreateTerrainGameObject(td);
            terrainGo.name = "Terrain";
            terrainGo.transform.SetParent(world.transform);
            terrainGo.transform.position = new Vector3(-meta.size / 2, meta.minHeight, -meta.size / 2);
            var terrain = terrainGo.GetComponent<Terrain>();
            terrain.heightmapPixelError = 3;
            terrain.basemapDistance = 400;

            // ---------- water ----------
            var water = GameObject.CreatePrimitive(PrimitiveType.Plane);
            water.name = "Water";
            UnityEngine.Object.DestroyImmediate(water.GetComponent<Collider>());
            water.transform.SetParent(world.transform);
            water.transform.position = new Vector3(0, meta.waterLevel, 0);
            water.transform.localScale = new Vector3(meta.size / 10, 1, meta.size / 10);
            water.GetComponent<Renderer>().sharedMaterial = SaveMat("Water", new Color(0.08f, 0.18f, 0.16f), 0.1f, 0.95f);

            // ---------- sun, sky, fog ----------
            var sun = UnityEngine.Object.FindObjectsOfType<Light>().FirstOrDefault(l => l.type == LightType.Directional);
            if (!sun) { sun = new GameObject("Sun").AddComponent<Light>(); sun.type = LightType.Directional; }
            sun.transform.rotation = Quaternion.LookRotation(-new Vector3(0.55f, 0.42f, -0.72f).normalized);
            sun.color = new Color(1f, 0.9f, 0.76f);
            sun.intensity = 1.6f;
            sun.shadows = LightShadows.Soft;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.0026f;
            RenderSettings.fogColor = new Color(0.62f, 0.6f, 0.54f);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.55f, 0.66f, 0.85f);
            RenderSettings.ambientEquatorColor = new Color(0.55f, 0.55f, 0.48f);
            RenderSettings.ambientGroundColor = new Color(0.25f, 0.22f, 0.15f);

            // ---------- cars + rider ----------
            var paint = SaveMat("CartPaint", new Color(0.91f, 0.63f, 0.11f), 0.35f, 0.65f);
            var dark = SaveMat("CartDark", new Color(0.16f, 0.18f, 0.14f), 0.3f, 0.5f);
            var seatM = SaveMat("Seat", new Color(0.16f, 0.1f, 0.08f), 0f, 0.45f);
            var chrome = SaveMat("Chrome", new Color(0.8f, 0.82f, 0.84f), 1f, 0.85f);
            var skin = SaveMat("Skin", new Color(0.91f, 0.77f, 0.63f), 0f, 0.3f);
            var cloth = SaveMat("Sleeve", new Color(0.18f, 0.36f, 0.54f), 0f, 0.2f);
            var cart = MakeCar("Cart Front", world.transform, paint, dark, seatM, chrome, true, out var lapBar);
            var cart2 = MakeCar("Cart Back", world.transform, paint, dark, seatM, chrome, false, out _);

            var headPivot = new GameObject("Head Pivot").transform;
            headPivot.SetParent(cart.transform, false);
            headPivot.localPosition = new Vector3(-0.38f, 1.36f, 0.42f);
            var cam = Camera.main;
            if (!cam) { cam = new GameObject("Main Camera").AddComponent<Camera>(); cam.gameObject.tag = "MainCamera"; cam.gameObject.AddComponent<AudioListener>(); }
            cam.transform.SetParent(headPivot, false);
            cam.transform.localPosition = Vector3.zero; cam.transform.localRotation = Quaternion.identity;
            cam.nearClipPlane = 0.05f; cam.farClipPlane = 3000f; cam.fieldOfView = 70;
            var headLook = cam.GetComponent<HeadLook>();
            if (!headLook) headLook = cam.gameObject.AddComponent<HeadLook>();
            // own hands on the grab bar (forearms + hands)
            foreach (int sd in new[] { -1, 1 })
            {
                var fore = Prim(PrimitiveType.Capsule, cart.transform, new Vector3(-0.38f + sd * 0.2f, 0.97f, 0.5f), new Vector3(0.07f, 0.16f, 0.07f), new Vector3(70, 0, 0), cloth);
                fore.name = "Forearm";
                Prim(PrimitiveType.Sphere, cart.transform, new Vector3(-0.38f + sd * 0.2f, 0.89f, 0.66f), new Vector3(0.09f, 0.06f, 0.12f), Vector3.zero, skin).name = "Hand";
            }

            // floating sign for countdown / messages (visible in VR)
            var signGo = new GameObject("Sign");
            signGo.transform.SetParent(headPivot, false);
            signGo.transform.localPosition = new Vector3(0, 0.1f, 2.6f);
            var tm = signGo.AddComponent<TextMesh>();
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            tm.font = font; tm.fontSize = 64; tm.characterSize = 0.012f; tm.anchor = TextAnchor.MiddleCenter; tm.alignment = TextAlignment.Center;
            tm.color = new Color(1f, 0.82f, 0.29f); tm.text = "DINO RUSH";
            signGo.GetComponent<MeshRenderer>().sharedMaterial = font.material;

            // ---------- managers ----------
            var mgr = new GameObject("DinoRush Managers");
            mgr.transform.SetParent(world.transform);
            var audioDir = mgr.AddComponent<AudioDirector>();
            var ride = mgr.AddComponent<RideController>();
            ride.trackJson = trackJson; ride.terrain = terrain;
            ride.cart = cart.transform; ride.cart2 = cart2.transform; ride.head = headPivot; ride.lapBar = lapBar;
            ride.sign = tm; ride.audioDir = audioDir; ride.headLook = headLook;
            var dir = mgr.AddComponent<EncounterDirector>();
            dir.ride = ride; dir.audioDir = audioDir; dir.terrain = terrain;
            dir.transform.SetParent(world.transform);
            // Cardboard helper lives in its own folder and needs the Cardboard package
            var cbType = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("DinoRush.CardboardStartup")).FirstOrDefault(t => t != null);
            if (cbType != null) mgr.AddComponent(cbType);
            else Debug.LogWarning("DinoRush: CardboardStartup not found yet. Install the Cardboard XR Plugin (README step 3), then run Build Scene again.");

            // place cart at the station so the scene view shows something sensible
            cart.transform.position = new Vector3(-40, 6, 0);
            cart2.transform.position = new Vector3(-42.75f, 6, 0);

            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            AssetDatabase.SaveAssets();
            Selection.activeGameObject = mgr;
            EditorUtility.DisplayDialog("DinoRush", "씬을 만들었어요!\n\n▶ Play 를 누르면 탑승이 시작돼요.\n에디터에서는 마우스 오른쪽 버튼 드래그로 둘러보고, R 키로 다시 출발해요.\n\n공룡 모델은 'DinoRush Managers' 의 Encounter Director > Species 에 넣으면 돼요.", "확인");
        }

        [MenuItem("DinoRush/2. 안드로이드 + 카드보드 설정 적용")]
        public static void AndroidSettings()
        {
            PlayerSettings.companyName = "DinoRush";
            PlayerSettings.productName = "Dino Rush VR";
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { UnityEngine.Rendering.GraphicsDeviceType.OpenGLES3 });
            PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.Android, "com.dinorush.vr");
            EditorUtility.DisplayDialog("DinoRush", "안드로이드 설정을 적용했어요.\n(가로 화면, IL2CPP, ARM64, Android 7.0 이상, OpenGL ES3)\n\n남은 것: Project Settings > XR Plug-in Management > Android 탭에서 'Cardboard XR Plugin' 체크 (README 4단계).", "확인");
        }

        // ---------- helpers ----------
        static Material SaveMat(string name, Color c, float metallic, float smooth)
        {
            string path = Gen + name + ".mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (!m) { m = TrackMeshBuilder.MakeMat(c, metallic, smooth); AssetDatabase.CreateAsset(m, path); }
            return m;
        }

        static GameObject Prim(PrimitiveType t, Transform parent, Vector3 p, Vector3 s, Vector3 e, Material m)
        {
            var g = GameObject.CreatePrimitive(t);
            UnityEngine.Object.DestroyImmediate(g.GetComponent<Collider>());
            g.transform.SetParent(parent, false);
            g.transform.localPosition = p; g.transform.localScale = s; g.transform.localEulerAngles = e;
            g.GetComponent<Renderer>().sharedMaterial = m;
            return g;
        }

        // simple open-top coaster car, forward = +Z, origin on the rails
        static GameObject MakeCar(string name, Transform parent, Material paint, Material dark, Material seat, Material chrome, bool front, out Transform ownBar)
        {
            var car = new GameObject(name);
            car.transform.SetParent(parent, false);
            Prim(PrimitiveType.Cube, car.transform, new Vector3(0, 0.36f, 0), new Vector3(1.7f, 0.28f, 2.5f), Vector3.zero, paint);           // floor pan
            foreach (int sd in new[] { -1, 1 })
                Prim(PrimitiveType.Cube, car.transform, new Vector3(sd * 0.84f, 0.68f, 0), new Vector3(0.1f, 0.42f, 2.2f), Vector3.zero, paint); // side walls
            if (front)
            {
                Prim(PrimitiveType.Cube, car.transform, new Vector3(0, 0.72f, 1.2f), new Vector3(1.7f, 0.6f, 0.35f), new Vector3(-20, 0, 0), paint); // nose / dash
                foreach (int sd in new[] { -1, 1 })
                    Prim(PrimitiveType.Sphere, car.transform, new Vector3(sd * 0.5f, 0.6f, 1.42f), Vector3.one * 0.18f, Vector3.zero, chrome);
            }
            else Prim(PrimitiveType.Cube, car.transform, new Vector3(0, 0.68f, 1.15f), new Vector3(1.7f, 0.4f, 0.12f), Vector3.zero, paint);
            ownBar = null;
            foreach (float row in new[] { 0.35f, -0.65f })
                foreach (float sx in new[] { -0.38f, 0.38f })
                {
                    Prim(PrimitiveType.Cube, car.transform, new Vector3(sx, 0.72f, row), new Vector3(0.62f, 0.12f, 0.55f), Vector3.zero, seat);
                    Prim(PrimitiveType.Cube, car.transform, new Vector3(sx, 0.98f, row - 0.3f), new Vector3(0.6f, 0.5f, 0.1f), new Vector3(-8, 0, 0), seat);
                    var hinge = new GameObject("Lap Bar").transform;
                    hinge.SetParent(car.transform, false);
                    hinge.localPosition = new Vector3(sx, 0.8f, row - 0.02f);
                    Prim(PrimitiveType.Cube, hinge, new Vector3(0, 0.02f, 0.28f), new Vector3(0.05f, 0.05f, 0.56f), Vector3.zero, chrome);
                    Prim(PrimitiveType.Cylinder, hinge, new Vector3(0, 0, 0.54f), new Vector3(0.12f, 0.22f, 0.12f), new Vector3(0, 0, 90), dark);
                    Prim(PrimitiveType.Cylinder, hinge, new Vector3(0, 0.07f, 0.33f), new Vector3(0.06f, 0.25f, 0.06f), new Vector3(0, 0, 90), chrome);
                    if (front && row > 0 && sx < 0) ownBar = hinge;
                }
            foreach (float zz in new[] { -0.8f, 0.8f })
                foreach (float sx in new[] { -0.56f, 0.56f })
                    Prim(PrimitiveType.Cylinder, car.transform, new Vector3(sx, 0.16f, zz), new Vector3(0.26f, 0.05f, 0.26f), new Vector3(0, 0, 90), dark);
            return car;
        }

        // grass / dirt / rock layers painted by slope and height
        static void PaintTerrain(TerrainData td, TerrainMeta meta)
        {
            var grass = Layer("Grass", new Color(0.30f, 0.38f, 0.15f), new Color(0.42f, 0.46f, 0.20f), 7);
            var dirt = Layer("Dirt", new Color(0.36f, 0.28f, 0.19f), new Color(0.47f, 0.38f, 0.26f), 5);
            var rock = Layer("Rock", new Color(0.40f, 0.38f, 0.35f), new Color(0.55f, 0.52f, 0.48f), 9);
            td.terrainLayers = new[] { grass, dirt, rock };
            int A = 512;
            td.alphamapResolution = A;
            var maps = new float[A, A, 3];
            for (int y = 0; y < A; y++)
                for (int x = 0; x < A; x++)
                {
                    float nx = (x + 0.5f) / A, ny = (y + 0.5f) / A;
                    float steep = td.GetSteepness(nx, ny);
                    float hh = td.GetInterpolatedHeight(nx, ny) + meta.minHeight;
                    float r = Mathf.Clamp01(Mathf.InverseLerp(22, 38, steep) + Mathf.InverseLerp(70, 120, hh));
                    float d = Mathf.Clamp01(1 - Mathf.InverseLerp(0.6f, 2.5f, hh)) * (1 - r);
                    d = Mathf.Max(d, Mathf.PerlinNoise(nx * 40, ny * 40) > 0.72f ? 0.6f * (1 - r) : 0);
                    float g = Mathf.Max(0, 1 - r - d);
                    maps[y, x, 0] = g; maps[y, x, 1] = d; maps[y, x, 2] = r;
                }
            td.SetAlphamaps(0, 0, maps);
        }

        static TerrainLayer Layer(string name, Color a, Color b, float tile)
        {
            string tp = Gen + name + "_tex.asset", lp = Gen + name + ".terrainlayer";
            var tex = new Texture2D(256, 256, TextureFormat.RGBA32, true) { name = name, wrapMode = TextureWrapMode.Repeat };
            var rnd = new System.Random(name.GetHashCode());
            for (int y = 0; y < 256; y++)
                for (int x = 0; x < 256; x++)
                {
                    float n = Mathf.PerlinNoise(x / 32f, y / 32f) * 0.6f + Mathf.PerlinNoise(x / 8f + 50, y / 8f + 50) * 0.3f + (float)rnd.NextDouble() * 0.1f;
                    tex.SetPixel(x, y, Color.Lerp(a, b, n));
                }
            tex.Apply(true);
            AssetDatabase.DeleteAsset(tp);
            AssetDatabase.CreateAsset(tex, tp);
            var layer = new TerrainLayer { diffuseTexture = tex, tileSize = new Vector2(tile, tile) };
            AssetDatabase.DeleteAsset(lp);
            AssetDatabase.CreateAsset(layer, lp);
            return layer;
        }
    }
}
