# DINO RUSH: 유니티 버전 (카드보드 VR)

웹 버전(`dino-coaster/`)의 트랙, 지형, 공룡 연출을 유니티로 옮긴 시작 키트입니다.
메뉴 버튼 하나로 지형, 트랙, 열차, 카메라, 공룡이 자동으로 배치되고, 안드로이드 폰용 카드보드 앱으로 빌드할 수 있어요.

> ⚠️ 이 키트의 C# 코드는 유니티에서 직접 컴파일해 보지 못했어요.
> 처음 열었을 때 Console 창에 빨간 오류가 나오면 **그 화면을 캡처해서 보내주세요.** 바로 고쳐드릴게요.

---

## PC로만 탈 때 (안드로이드 없이)

- **건너뛸 단계:** 3단계(카드보드 플러그인), 6단계, 7단계
- **할 단계:** 1 → 2 → 4 → 5단계만 하면 PC에서 ▶ Play로 바로 탈 수 있어요.
- **조작:** 마우스 오른쪽 드래그로 둘러보기, R로 정면, 스페이스로 다시 출발
- **실행 파일(.exe)로 만들기:**
  1. **File → Build Settings** → **Windows, Mac, Linux** 선택
  2. Target Platform **Windows**, Architecture **x86_64** (이게 x64예요)
  3. **Add Open Scenes** → **Build** → 폴더 선택
  4. 만들어진 `DinoRushVR.exe` 를 실행하면 돼요.

## 준비물

- 윈도우 PC (메모리 8GB 이상 권장, 저장 공간 20GB 이상)
- 안드로이드 폰 (Android 7.0 이상), USB 케이블, 카드보드

---

## 1단계: 유니티 설치 (약 30분~1시간)

1. https://unity.com/download 에서 **Unity Hub**를 받아 설치하고 로그인합니다 (무료 Personal 라이선스).
2. Unity Hub → **Installs → Install Editor** → **2022.3 LTS** 버전을 고릅니다.
3. 모듈 선택 화면에서 **Android Build Support**를 체크하고, 그 아래 **OpenJDK**와 **Android SDK & NDK Tools**도 같이 체크합니다.
4. 카드보드 플러그인을 받으려면 **Git**이 필요해요. https://git-scm.com/download/win 에서 설치하세요 (전부 기본값으로 Next). 설치 후 Unity Hub를 껐다 켜세요.

## 2단계: 새 프로젝트 만들기

1. Unity Hub → **Projects → New project** → 템플릿 **3D (URP)** → 이름 `DinoRushVR` → Create.
2. 열리면 **Edit → Project Settings → Player → Other Settings → Active Input Handling** 을 **Both** 로 바꿉니다 (유니티가 재시작돼요).

## 3단계: 카드보드 플러그인 설치

1. **Window → Package Manager** 를 엽니다.
2. 왼쪽 위 **+** 버튼 → **Add package from git URL...** 을 누르고 아래 주소를 넣고 Add:
   ```
   https://github.com/googlevr/cardboard-xr-plugin.git
   ```
3. 설치가 끝날 때까지 기다립니다 (몇 분 걸릴 수 있어요).

## 4단계: DinoRush 파일 넣기

1. 이 GitHub 저장소에서 **Code → Download ZIP** 으로 받고 압축을 풉니다.
2. 압축 푼 폴더의 `unity-dino-rush/Assets/DinoRush` 폴더를 통째로 유니티 프로젝트의 **Assets** 폴더 안에 복사합니다.
   (유니티 Project 창의 Assets에 끌어다 놓아도 돼요.)
3. 유니티가 스크립트를 컴파일할 때까지 기다리면, 위쪽 메뉴에 **DinoRush** 메뉴가 생겨요.

## 5단계: 씬 자동 만들기, 에디터에서 타보기

1. 메뉴 **DinoRush → 1. 씬 자동 만들기 (Build Scene)** 를 누릅니다.
2. 지형, 물, 햇빛, 안개, 열차, 카메라, 관리자 오브젝트가 자동으로 생겨요.
3. **Ctrl+S** 로 씬을 저장합니다 (이름 예: `Ride`).
4. 위쪽 **▶ Play** 버튼을 누르면 탑승이 시작돼요.
   - **마우스 오른쪽 드래그:** 둘러보기
   - **스페이스:** 다시 출발
   - **R:** 정면 재설정
   - 공룡 모델을 아직 안 넣었으면 단순한 도형 공룡이 대신 나와요. 연출과 타이밍은 똑같이 동작해요.

## 6단계: 안드로이드 + 카드보드 설정

1. **File → Build Settings** → **Android** 선택 → **Switch Platform**.
2. 같은 창에서 **Add Open Scenes** 를 눌러 지금 씬을 추가합니다.
3. 메뉴 **DinoRush → 2. 안드로이드 + 카드보드 설정 적용** 을 누릅니다 (가로 화면, IL2CPP, ARM64, OpenGL ES3 자동 설정).
4. **Edit → Project Settings → XR Plug-in Management** → **Android 탭**(로봇 아이콘)에서 **Cardboard XR Plugin** 을 체크합니다.

## 7단계: 폰에 설치

1. 폰에서 **설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드번호** 를 7번 누르면 개발자 모드가 켜져요.
2. **설정 → 개발자 옵션 → USB 디버깅** 을 켭니다.
3. USB로 PC와 연결하고, 폰에 뜨는 "USB 디버깅 허용"을 누릅니다.
4. 유니티 **File → Build Settings → Build And Run** → 저장할 이름 입력 (예: `DinoRush.apk`).
5. 처음 실행하면 카드보드 뷰어의 QR 코드를 찍으라고 나와요 (카드보드 상자에 있어요. 없으면 Skip).
6. 폰을 카드보드에 끼우고 타세요! 화면을 두 번 탭하면 정면이 재설정돼요.

---

## 공룡 모델 넣기 (무료)

> **쉬운 방법:** FBX를 Assets에 넣고 메뉴 **DinoRush → 3. 공룡 모델 연결** 을 누르세요.
> 모델을 칸에 끌어다 놓고, 공룡 종류를 고른 다음 **연결하기** 를 누르면
> 리그, 애니메이터, 텍스처, 프리팹, 공룡 칸 연결까지 자동으로 해줘요. (아래 2~5번을 대신 해줌)
> FBX가 없고 **GLB**만 있으면: Window → Package Manager → **+** → **Add package by name** → `com.unity.cloud.gltfast` 를 먼저 설치하세요.

1. **무료 모델 찾기**
   - **Unity Asset Store** (Window → Package Manager → My Assets, 또는 assetstore.unity.com): "dinosaur" 검색 후 가격 필터를 **Free**로
   - **Sketchfab** (sketchfab.com): "dinosaur animated" 검색, **Downloadable** 체크, 라이선스가 **CC BY** 인지 확인, **FBX** 형식으로 받기
   - **애니메이션(걷기, 달리기, 포효)이 들어 있는 모델**을 고르세요.
2. **가져오기:** FBX를 Assets에 넣고 → 선택 → Inspector의 **Rig** 탭 → Animation Type **Generic** → Apply.
3. **애니메이터 만들기:** Project 창에서 우클릭 → Create → **Animator Controller**. 아래처럼 파라미터를 만들고 모델의 애니메이션 클립을 연결합니다.
   - `Speed` (Float): 걷기/달리기 Blend Tree (0 = 서 있기, 3 = 걷기, 10 이상 = 달리기)
   - `Roar` (Trigger): 포효
   - `Attack` (Trigger): 물기·돌진
   - `Eat` (Bool): 풀 뜯기, 물 마시기, 먹이 먹기
   - 없는 파라미터는 그냥 무시되니, 있는 것만 만들어도 돼요.
4. **연결하기:** 모델을 씬에 끌어다 놓고, Animator 컴포넌트에 위 컨트롤러를 넣은 다음, 다시 Project 창으로 끌어서 **프리팹**으로 만듭니다.
5. **DinoRush Managers → Encounter Director → Species** 목록에서 해당 공룡(rex, raptor, trike…)의 **Prefab** 칸에 프리팹을 넣습니다.
   - **크기:** 실제 크기(Length)에 맞춰 자동으로 조절돼요.
   - **방향:** 공룡이 옆이나 뒤를 보고 있으면 **Yaw Offset** 을 90, 180, -90 중 하나로 바꿔보세요.

## 소리 넣기 (선택)

기본으로 합성 소리가 나요. 더 진짜 같게 하려면 freesound.org 에서 **CC0** 라이선스 소리(포효, 바람, 레일 소리)를 받아
**DinoRush Managers → Audio Director** 의 칸에 넣으세요. 안내 방송을 직접 녹음해서 **Announcement** 에 넣어도 돼요.

## 숲 만들기

숲은 탑승할 때 자동으로 깔려요(나무, 야자수, 덤불, 고사리). 더 예쁜 나무를 쓰려면 Asset Store에서 무료 나무 모델을 받아 **DinoRush Managers → World Extras → Tree Prefab** 칸에 넣으세요.

## 퀄리티 더 올리기

- **영화 같은 화면:** Hierarchy → 우클릭 → Volume → Global Volume → 새 Profile → **Bloom, Color Adjustments, Vignette, Tonemapping(ACES)** 추가
- **그림자:** Project Settings → Graphics → URP 에셋의 **Shadow Distance** 를 80 정도로

---

## 웹 버전에서 옮겨온 것 (전부)

- **트랙:** 64m 수직 낙하와 정지, 런치 119km/h, 360° 회전 2개, 랩터 협곡 111km/h, 물속 석호 잠수(물 저항), **부스터 2곳**, 긴급 탈출 모드 경보
- **탑승감:** 관성 머리 흔들림, 충돌 흔들림과 출렁임, 진동, 안전바, 출발 신호음
- **화면 효과 (VR에서도 보임):** 경고창, 독침 자국, 유리 금, 물방울, 물속 푸른빛, 피격 붉은 번쩍임, 속도·G 어두워짐
- **설정:** F 키 속도감 시야, G 키 흔들림·관성 켜고 끄기
- **월드:** 숲(나무 2,000여 그루, GPU 인스턴싱), 동굴(종유석, 빛나는 수정, 화석, 횃불 조명, 물방울, 박쥐 떼), 물속 유리 터널과 해초, 역사, 연기 나는 화산, 타이틀 화면 공룡 라인업
- **공룡 연출:** 티라노 매복과 식사(새끼, 콤프소그나투스), 스피노, 모사사우루스 점프와 유리 박치기, 플레시오사우루스, 둔클레오스테우스, 바다거북, 암모나이트, 물고기 떼, 브라키오, 트리케라톱스 무리 돌진·레일 점프·충돌, 랩터(울음 빌드업, 무리 습격, 열차 올라타기, 머리 위 점프, 동굴 추격), 카르노(매복, 사냥), 딜로포 독침, 파키 박치기, 거대 티라노, 프테라노돈(급강하, V자 비행, 낚시), 같은 종 무리 습성(이동, 방어 원형, 꼬리 휘두르기, 합창, 보초)

**웹과 다른 점**
- 공룡은 웹처럼 코드로 몸을 만들지 않아요. 직접 넣는 모델(프리팹)을 쓰고, 넣기 전에는 도형 공룡이 나와요.
- 목 굽히기와 꼬리 흔들기는 모델의 애니메이션 파라미터로 해요: `Speed`, `Roar`, `Attack`, `Eat`, `TailSwing`, `Swim`, `Frill`, `Spit`

**새로 추가된 종 칸 (Species)**
- `dilo`, `pachy`, `mosa`, `plesio`, `dunkle`
- `Swim` 체크된 종은 물속에서 몸 중심 기준으로 배치돼요.
- 프테라노돈 모델은 `Ptero Prefab` 칸에 넣으세요. 날개 이름이 `WingL`/`WingR`이면 퍼덕여요.


## 데이터 다시 뽑기

웹 버전의 트랙이나 지형을 바꿨다면 `tools/export-from-web.mjs` 로 `Data/` 파일을 다시 만들 수 있어요:

```
cd dino-coaster
npm i three@0.160.0
cd ../unity-dino-rush/tools
node export-from-web.mjs
```
