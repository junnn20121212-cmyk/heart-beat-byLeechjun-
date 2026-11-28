// Menu "DinoRush > 3. 공룡 모델 연결": turns a downloaded animated model (FBX from
// Sketchfab / Asset Store) into a ready DinoRush prefab in one click.
//  1. sets the rig to Generic and loops the walk/run/idle/eat clips
//  2. guesses what each animation clip is from its name (you can change it)
//  3. builds an Animator Controller with the parameters DinoActor uses
//     (Speed blend idle/walk/run, Roar / Attack / Spit triggers, Eat bool)
//  4. fixes missing textures (URP Lit materials from the textures next to the model)
//  5. saves a prefab and puts it into the species slot of the open scene
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace DinoRush.EditorTools
{
    public class DinoModelLinker : EditorWindow
    {
        enum Role { 안씀, 서있기, 걷기, 달리기, 포효, 공격, 먹기 }
        static readonly string[] RoleHelp = { "사용 안 함", "가만히 서 있기 (idle)", "걷기 (walk)", "달리기 (run)", "포효 (roar)", "공격·물기 (attack)", "먹기·마시기 (eat)" };

        static readonly string[] DefaultSpecies = { "rex", "carno", "spino", "raptor", "brachio", "stego", "trike", "parasaur", "ankylo", "compy", "dilo", "pachy", "mosa", "plesio", "dunkle", "ptero" };
        static readonly string[] SpeciesKo = { "티라노사우루스", "카르노타우루스", "스피노사우루스", "랩터", "브라키오사우루스", "스테고사우루스", "트리케라톱스", "파라사우롤로푸스", "안킬로사우루스", "콤프소그나투스", "딜로포사우루스", "파키케팔로사우루스", "모사사우루스", "플레시오사우루스", "둔클레오스테우스", "프테라노돈" };
        static readonly int[] YawValues = { 0, 90, 180, -90 };
        static readonly string[] YawLabels = { "0 (그대로)", "90 (오른쪽으로 돌리기)", "180 (뒤로 돌리기)", "-90 (왼쪽으로 돌리기)" };
        const string OutDir = "Assets/DinoRush/Models/";

        GameObject model;
        int speciesIndex;
        int yawIndex;
        bool fixMaterials = true;
        string lastPath;
        readonly List<string> clipNames = new List<string>();
        readonly List<Role> clipRoles = new List<Role>();
        Vector2 scroll;
        string status = "";

        [MenuItem("DinoRush/3. 공룡 모델 연결 (다운받은 모델 → 공룡 칸)")]
        static void Open()
        {
            var w = GetWindow<DinoModelLinker>(true, "공룡 모델 연결");
            w.minSize = new Vector2(440, 480);
            var sel = Selection.activeObject as GameObject;
            if (sel && AssetDatabase.Contains(sel)) w.SetModel(sel);
            w.Show();
        }

        [MenuItem("Assets/DinoRush: 이 모델로 공룡 만들기", false, 2000)]
        static void OpenFromAsset() => Open();

        [MenuItem("Assets/DinoRush: 이 모델로 공룡 만들기", true)]
        static bool OpenFromAssetValid() => Selection.activeObject is GameObject && AssetDatabase.Contains(Selection.activeObject);

        void SetModel(GameObject g)
        {
            model = g;
            status = "";
            ReadClips();
            // guess the species from the file name
            if (g)
            {
                string n = g.name.ToLowerInvariant();
                string[][] keys = {
                    new[]{"rex","tyran"}, new[]{"carno"}, new[]{"spino"}, new[]{"raptor","veloci","deinony","utah"}, new[]{"brachio","sauropod","diplo","bronto"},
                    new[]{"stego"}, new[]{"trice","trike"}, new[]{"parasaur","hadro"}, new[]{"ankylo"}, new[]{"compy","compso"}, new[]{"dilo"},
                    new[]{"pachy"}, new[]{"mosa"}, new[]{"plesio"}, new[]{"dunkle"}, new[]{"ptero","ptera","quetz"} };
                for (int i = 0; i < keys.Length; i++)
                    if (keys[i].Any(k => n.Contains(k))) { speciesIndex = i; break; }
            }
        }

        void ReadClips()
        {
            clipNames.Clear(); clipRoles.Clear();
            if (!model) return;
            lastPath = AssetDatabase.GetAssetPath(model);
            if (IsGltf(lastPath)) EnsureGltfMecanim(lastPath);
            foreach (var c in LoadClips(lastPath)) { clipNames.Add(c.name); clipRoles.Add(Guess(c.name)); }
            // nothing recognised: the first clip becomes the walk cycle
            if (clipRoles.Count > 0 && !clipRoles.Any(r => r == Role.걷기 || r == Role.달리기 || r == Role.서있기))
            {
                int i = clipRoles.IndexOf(Role.안씀);
                if (i < 0) i = 0;
                clipRoles[i] = Role.걷기;
            }
        }

        static bool IsGltf(string path)
        {
            string e = Path.GetExtension(path).ToLowerInvariant();
            return e == ".glb" || e == ".gltf";
        }

        // glTFast imports animations as Legacy by default; Animator needs "Mecanim".
        static void EnsureGltfMecanim(string path)
        {
            var imp = AssetImporter.GetAtPath(path);
            if (!imp || imp is ModelImporter) return;
            var so = new SerializedObject(imp);
            var it = so.GetIterator();
            bool changed = false;
            while (it.Next(true))
            {
                if (it.propertyType != SerializedPropertyType.Enum) continue;
                if (!it.name.ToLowerInvariant().Contains("animationmethod")) continue;
                int mec = System.Array.FindIndex(it.enumNames, n => n.ToLowerInvariant().Contains("mecanim"));
                if (mec >= 0 && it.enumValueIndex != mec) { it.enumValueIndex = mec; changed = true; }
            }
            if (changed) { so.ApplyModifiedPropertiesWithoutUndo(); imp.SaveAndReimport(); }
        }

        static Role Guess(string name)
        {
            string n = name.ToLowerInvariant();
            if (Has(n, "idle", "stand", "breath", "rest", "look")) return Role.서있기;
            if (Has(n, "run", "sprint", "gallop", "charge", "trot", "chase")) return Role.달리기;
            if (Has(n, "walk", "move", "step", "locomot")) return Role.걷기;
            if (Has(n, "roar", "scream", "call", "howl", "growl", "shout", "yell")) return Role.포효;
            if (Has(n, "attack", "bite", "hit", "strike", "atk", "claw", "tail", "headbutt", "ram")) return Role.공격;
            if (Has(n, "eat", "graze", "drink", "feed", "chew", "sniff")) return Role.먹기;
            return Role.안씀;
        }

        static bool Has(string n, params string[] keys) => keys.Any(n.Contains);

        static List<AnimationClip> LoadClips(string path) =>
            AssetDatabase.LoadAllAssetRepresentationsAtPath(path).OfType<AnimationClip>()
                .Where(c => !c.name.StartsWith("__preview__")).ToList();

        string[] SpeciesList()
        {
            var dir = Object.FindFirstObjectByType<EncounterDirector>();
            if (!dir || dir.species == null || dir.species.Count == 0) return DefaultSpecies;
            var l = dir.species.Select(s => s.name).ToList();
            if (!l.Contains("ptero")) l.Add("ptero");
            return l.ToArray();
        }

        static string Label(string sp)
        {
            int i = System.Array.IndexOf(DefaultSpecies, sp);
            return i >= 0 ? $"{sp}  ({SpeciesKo[i]})" : sp;
        }

        void OnGUI()
        {
            EditorGUILayout.Space(6);
            EditorGUILayout.HelpBox("1) 모델(FBX)을 아래 칸에 끌어다 놓으세요.\n2) 어떤 공룡인지 고르세요.\n3) 동작 이름 옆에서 무슨 동작인지 확인하세요 (자동으로 추측해요).\n4) 맨 아래 [연결하기]를 누르세요.", MessageType.Info);

            var g = (GameObject)EditorGUILayout.ObjectField("모델 (FBX)", model, typeof(GameObject), false);
            if (g != model || (model && AssetDatabase.GetAssetPath(model) != lastPath)) SetModel(g);

            var sp = SpeciesList();
            speciesIndex = Mathf.Clamp(speciesIndex, 0, sp.Length - 1);
            speciesIndex = EditorGUILayout.Popup("어떤 공룡?", speciesIndex, sp.Select(Label).ToArray());
            yawIndex = EditorGUILayout.Popup(new GUIContent("방향 돌리기", "타 보고 공룡이 옆이나 뒤를 보고 걸으면 바꾸세요"), yawIndex, YawLabels);
            fixMaterials = EditorGUILayout.Toggle(new GUIContent("텍스처 자동 고치기", "색이 하얗거나 분홍색이면 모델 옆의 그림 파일을 찾아 붙여요"), fixMaterials);

            EditorGUILayout.Space(8);
            EditorGUILayout.LabelField("동작 (애니메이션)", EditorStyles.boldLabel);
            if (!model) EditorGUILayout.LabelField("  모델을 먼저 넣어주세요.");
            else if (clipNames.Count == 0)
                EditorGUILayout.HelpBox("이 모델에서 동작을 못 찾았어요. 움직이지 않는 공룡으로 들어가요.\n(Inspector → Animation 탭 → Import Animation 이 켜져 있는지 확인하세요)", MessageType.Warning);
            else
            {
                scroll = EditorGUILayout.BeginScrollView(scroll, GUILayout.MaxHeight(220));
                for (int i = 0; i < clipNames.Count; i++)
                {
                    EditorGUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField(clipNames[i], GUILayout.MinWidth(160));
                    clipRoles[i] = (Role)EditorGUILayout.Popup((int)clipRoles[i], RoleHelp, GUILayout.Width(190));
                    EditorGUILayout.EndHorizontal();
                }
                EditorGUILayout.EndScrollView();
                EditorGUILayout.LabelField("  동작이 하나뿐이면 '걷기'로 두면 돼요.", EditorStyles.miniLabel);
            }

            EditorGUILayout.Space(10);
            GUI.enabled = model;
            if (GUILayout.Button("연결하기", GUILayout.Height(36))) Link(sp[speciesIndex]);
            GUI.enabled = true;
            if (!string.IsNullOrEmpty(status)) EditorGUILayout.HelpBox(status, status.StartsWith("완료") ? MessageType.Info : MessageType.Error);
        }

        void Link(string species)
        {
            string path = AssetDatabase.GetAssetPath(model);
            var importer = AssetImporter.GetAtPath(path) as ModelImporter;
            bool gltf = IsGltf(path);
            if (importer == null && !gltf) { status = "이 파일은 3D 모델이 아니에요. FBX 또는 GLB 파일을 넣어주세요."; return; }
            if (gltf && AssetImporter.GetAtPath(path) is ModelImporter == false && AssetImporter.GetAtPath(path).GetType().Name == "DefaultImporter")
            { status = "GLB를 읽으려면 glTFast 패키지가 필요해요.\nWindow → Package Manager → + → Add package by name → com.unity.cloud.gltfast"; return; }
            Directory.CreateDirectory(OutDir);
            Directory.CreateDirectory(OutDir + species + "_Clips");

            var roleOf = new Dictionary<string, Role>();
            for (int i = 0; i < clipNames.Count; i++) roleOf[clipNames[i]] = clipRoles[i];
            bool IsLoop(Role r) => r == Role.서있기 || r == Role.걷기 || r == Role.달리기 || r == Role.먹기;
            List<AnimationClip> clips;
            if (importer == null)
            {
                // glTF / GLB (glTFast): clips are read-only sub-assets, so save looping Mecanim copies
                clips = new List<AnimationClip>();
                foreach (var src in LoadClips(path))
                {
                    roleOf.TryGetValue(src.name, out var r);
                    if (r == Role.안씀) continue;
                    var c = Instantiate(src);
                    c.name = src.name;
                    c.legacy = false;
                    var set = AnimationUtility.GetAnimationClipSettings(c);
                    set.loopTime = IsLoop(r);
                    AnimationUtility.SetAnimationClipSettings(c, set);
                    string safe = string.Concat(src.name.Split(Path.GetInvalidFileNameChars()));
                    string cp = $"{OutDir}{species}_Clips/{(safe.Length > 0 ? safe : "clip")}.anim";
                    AssetDatabase.DeleteAsset(cp);
                    AssetDatabase.CreateAsset(c, cp);
                    clips.Add(c);
                }
            }
            else
            {
                clips = ImportFbx(importer, path, roleOf, IsLoop);
            }
            LinkRest(species, path, clips, roleOf);
        }

        static List<AnimationClip> ImportFbx(ModelImporter importer, string path, Dictionary<string, Role> roleOf, System.Func<Role, bool> isLoop)
        {
            // 1. rig + looping
            if (importer.animationType == ModelImporterAnimationType.None || importer.animationType == ModelImporterAnimationType.Legacy)
                importer.animationType = ModelImporterAnimationType.Generic;
            importer.importAnimation = true;
            var defs = importer.clipAnimations;
            if (defs == null || defs.Length == 0) defs = importer.defaultClipAnimations;
            foreach (var d in defs)
            {
                roleOf.TryGetValue(d.name, out var r);
                bool loop = isLoop(r);
                d.loopTime = loop; d.loopPose = loop;
            }
            importer.clipAnimations = defs;
            importer.SaveAndReimport();
            return LoadClips(path);
        }

        void LinkRest(string species, string path, List<AnimationClip> clips, Dictionary<string, Role> roleOf)
        {
            // 2. clips by role
            AnimationClip Pick(Role r) => clips.FirstOrDefault(c => roleOf.TryGetValue(c.name, out var x) && x == r);
            var idle = Pick(Role.서있기); var walk = Pick(Role.걷기); var run = Pick(Role.달리기);
            var roar = Pick(Role.포효); var attack = Pick(Role.공격); var eat = Pick(Role.먹기);

            // 3. animator controller
            string ctrlPath = OutDir + species + "_Animator.controller";
            AssetDatabase.DeleteAsset(ctrlPath);
            var ctrl = AnimatorController.CreateAnimatorControllerAtPath(ctrlPath);
            ctrl.AddParameter("Speed", AnimatorControllerParameterType.Float);
            ctrl.AddParameter("Roar", AnimatorControllerParameterType.Trigger);
            ctrl.AddParameter("Attack", AnimatorControllerParameterType.Trigger);
            ctrl.AddParameter("Spit", AnimatorControllerParameterType.Trigger);
            ctrl.AddParameter("Eat", AnimatorControllerParameterType.Bool);
            var sm = ctrl.layers[0].stateMachine;

            AnimatorState move = null;
            if (idle || walk || run)
            {
                move = ctrl.CreateBlendTreeInController("Move", out BlendTree tree, 0);
                tree.blendType = BlendTreeType.Simple1D;
                tree.blendParameter = "Speed";
                tree.useAutomaticThresholds = false;
                // m/s of the (scaled) animal: 0 stand, 3 walk, 10+ run
                tree.AddChild(idle ? idle : (walk ? walk : run), 0f);
                if (walk) tree.AddChild(walk, 3f);
                if (run) tree.AddChild(run, 10f);
                else if (walk) tree.AddChild(walk, 10f);
                sm.defaultState = move;
            }
            else
            {
                move = sm.AddState("Idle");
                sm.defaultState = move;
            }

            void Action(string stateName, AnimationClip clip, string trigger)
            {
                if (!clip) return;
                var st = sm.states.Select(s => s.state).FirstOrDefault(s => s.name == stateName) ?? sm.AddState(stateName);
                st.motion = clip;
                var go = move.AddTransition(st);
                go.AddCondition(AnimatorConditionMode.If, 0, trigger);
                go.hasExitTime = false; go.duration = 0.15f;
                if (st.transitions.Length == 0)
                {
                    var back = st.AddTransition(move);
                    back.hasExitTime = true; back.exitTime = 0.9f; back.duration = 0.25f;
                }
            }
            Action("Roar", roar, "Roar");
            Action("Attack", attack ? attack : roar, "Attack");
            Action("Attack", attack ? attack : roar, "Spit");
            if (eat)
            {
                var st = sm.AddState("Eat");
                st.motion = eat;
                var go = move.AddTransition(st);
                go.AddCondition(AnimatorConditionMode.If, 0, "Eat");
                go.hasExitTime = false; go.duration = 0.3f;
                var back = st.AddTransition(move);
                back.AddCondition(AnimatorConditionMode.IfNot, 0, "Eat");
                back.hasExitTime = false; back.duration = 0.3f;
            }
            EditorUtility.SetDirty(ctrl);

            // 4. prefab
            var inst = (GameObject)Instantiate(model);
            inst.name = species;
            foreach (var legacy in inst.GetComponentsInChildren<Animation>()) DestroyImmediate(legacy);
            var anim = inst.GetComponentInChildren<Animator>();
            if (!anim)
            {
                anim = inst.AddComponent<Animator>();
                anim.avatar = AssetDatabase.LoadAllAssetRepresentationsAtPath(path).OfType<Avatar>().FirstOrDefault();
            }
            anim.runtimeAnimatorController = ctrl;
            anim.applyRootMotion = false;
            anim.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
            int fixedMats = fixMaterials ? FixMaterials(inst, path, species) : 0;

            string prefabPath = OutDir + species + ".prefab";
            var prefab = PrefabUtility.SaveAsPrefabAsset(inst, prefabPath);
            DestroyImmediate(inst);
            AssetDatabase.SaveAssets();

            // 5. into the scene's species slot
            string where;
            var dir = Object.FindFirstObjectByType<EncounterDirector>();
            if (!dir) where = "씬에 DinoRush Managers가 없어서 칸에 넣지 못했어요. 먼저 'DinoRush → 1. 씬 자동 만들기'를 하고 다시 눌러주세요.";
            else
            {
                Undo.RecordObject(dir, "공룡 모델 연결");
                if (species == "ptero") dir.pteroPrefab = prefab;
                else
                {
                    var slot = dir.species.FirstOrDefault(s => s.name == species);
                    if (slot == null) { slot = new SpeciesSlot { name = species }; dir.species.Add(slot); }
                    slot.prefab = prefab;
                    slot.yawOffset = YawValues[yawIndex];
                }
                EditorUtility.SetDirty(dir);
                EditorSceneManager.MarkSceneDirty(dir.gameObject.scene);
                where = $"'{Label(species)}' 칸에 넣었어요. Ctrl+S로 씬을 저장하고 ▶ Play 해보세요.";
            }

            string got = string.Join(", ", new[] { idle ? "서있기" : null, walk ? "걷기" : null, run ? "달리기" : null, roar ? "포효" : null, attack ? "공격" : null, eat ? "먹기" : null }.Where(x => x != null));
            status = $"완료! 프리팹: {prefabPath}\n연결된 동작: {(got.Length > 0 ? got : "없음")}" +
                     (fixedMats > 0 ? $"\n텍스처 고친 재질: {fixedMats}개" : "") + "\n" + where;
            Selection.activeObject = prefab;
            EditorGUIUtility.PingObject(prefab);
        }

        // Materials that came in blank (no texture) or with a non-URP shader get a URP Lit
        // copy using the textures found next to the model (Sketchfab zips put them in /textures).
        static int FixMaterials(GameObject inst, string modelPath, string species)
        {
            var lit = Shader.Find("Universal Render Pipeline/Lit");
            if (!lit) return 0;
            string folder = Path.GetDirectoryName(modelPath).Replace('\\', '/');
            var texs = AssetDatabase.FindAssets("t:Texture2D", new[] { folder })
                .Select(AssetDatabase.GUIDToAssetPath).ToList();
            // Sketchfab zips: model in /source, textures in a sibling /textures folder
            string parent = Path.GetDirectoryName(folder)?.Replace('\\', '/');
            if (texs.Count == 0 && !string.IsNullOrEmpty(parent) && parent.StartsWith("Assets/"))
                texs = AssetDatabase.FindAssets("t:Texture2D", new[] { parent }).Select(AssetDatabase.GUIDToAssetPath).ToList();
            if (texs.Count == 0) return 0;

            bool IsColor(string p) { var n = Path.GetFileNameWithoutExtension(p).ToLowerInvariant(); return Has(n, "basecolor", "base_color", "diffuse", "albedo", "_col", "color", "_d") && !Has(n, "normal", "rough", "metal", "emiss", "occlu", "_ao", "spec", "gloss"); }
            bool IsNormal(string p) { var n = Path.GetFileNameWithoutExtension(p).ToLowerInvariant(); return Has(n, "normal", "nrm", "_nor", "_n."); }
            bool IsEmit(string p) { var n = Path.GetFileNameWithoutExtension(p).ToLowerInvariant(); return Has(n, "emiss", "emit"); }
            var colors = texs.Where(IsColor).ToList();
            var normals = texs.Where(IsNormal).ToList();
            var emits = texs.Where(IsEmit).ToList();
            // a lone texture with an unusual name is almost surely the colour map
            if (colors.Count == 0) colors = texs.Where(t => !IsNormal(t) && !IsEmit(t) && !Has(Path.GetFileName(t).ToLowerInvariant(), "rough", "metal", "occlu", "_ao")).ToList();

            var rends = inst.GetComponentsInChildren<Renderer>();
            int matCount = rends.SelectMany(r => r.sharedMaterials).Where(m => m).Distinct().Count();
            string Match(List<string> list, string matName)
            {
                if (list.Count == 0) return null;
                string mn = matName.ToLowerInvariant().Replace(" ", "_").Replace("(instance)", "").Trim('_');
                var hit = list.FirstOrDefault(t => mn.Length > 1 && Path.GetFileNameWithoutExtension(t).ToLowerInvariant().Replace(" ", "_").StartsWith(mn));
                if (hit != null) return hit;
                hit = list.FirstOrDefault(t => mn.Length > 2 && Path.GetFileNameWithoutExtension(t).ToLowerInvariant().Contains(mn));
                if (hit != null) return hit;
                return (list.Count == 1 || matCount == 1) ? list[0] : null;
            }

            string matDir = OutDir + species + "_Materials";
            Directory.CreateDirectory(matDir);
            var made = new Dictionary<Material, Material>();
            foreach (var r in rends)
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    var old = mats[i];
                    string mname = old ? old.name : "mat" + i;
                    if (old && made.TryGetValue(old, out var done)) { mats[i] = done; continue; }
                    bool urp = old && old.shader && old.shader.name.StartsWith("Universal Render Pipeline");
                    Texture baseTex = null;
                    if (old && old.HasProperty("_BaseMap")) baseTex = old.GetTexture("_BaseMap");
                    if (!baseTex && old && old.HasProperty("_MainTex")) baseTex = old.GetTexture("_MainTex");
                    bool gltfShader = old && old.shader && old.shader.name.ToLowerInvariant().Contains("gltf");
                    if ((urp && baseTex) || gltfShader) continue;

                    var m = new Material(lit) { name = mname };
                    string cp = baseTex ? null : Match(colors, mname);
                    if (!baseTex && cp != null) baseTex = AssetDatabase.LoadAssetAtPath<Texture2D>(cp);
                    if (baseTex) { m.SetTexture("_BaseMap", baseTex); m.SetColor("_BaseColor", Color.white); }
                    else if (old && old.HasProperty("_Color")) m.SetColor("_BaseColor", old.GetColor("_Color"));
                    string np = Match(normals, mname);
                    if (np != null)
                    {
                        if (AssetImporter.GetAtPath(np) is TextureImporter ti && ti.textureType != TextureImporterType.NormalMap)
                        { ti.textureType = TextureImporterType.NormalMap; ti.SaveAndReimport(); }
                        m.SetTexture("_BumpMap", AssetDatabase.LoadAssetAtPath<Texture2D>(np));
                        m.EnableKeyword("_NORMALMAP");
                    }
                    string ep = Match(emits, mname);
                    if (ep != null)
                    {
                        m.SetTexture("_EmissionMap", AssetDatabase.LoadAssetAtPath<Texture2D>(ep));
                        m.SetColor("_EmissionColor", Color.white);
                        m.EnableKeyword("_EMISSION");
                    }
                    m.SetFloat("_Smoothness", 0.25f);
                    string safe = string.Concat(mname.Split(Path.GetInvalidFileNameChars()));
                    string mp = AssetDatabase.GenerateUniqueAssetPath($"{matDir}/{(safe.Length > 0 ? safe : "mat")}.mat");
                    AssetDatabase.CreateAsset(m, mp);
                    if (old) made[old] = m;
                    mats[i] = m;
                }
                r.sharedMaterials = mats;
            }
            return made.Count;
        }
    }
}
