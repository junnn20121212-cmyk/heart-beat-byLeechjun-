// 심장 순환 애니메이션 (콘솔)
//   빨간 O = 동맥혈(산소 많음), 파란 O = 정맥혈(산소 적음)
//   온몸 순환: 좌심실 → 대동맥 → 온몸 → 대정맥 → 우심방
//   폐순환  : 우심실 → 폐동맥 → 폐   → 폐정맥 → 좌심방
//
// Dev-C++에서 F11로 바로 실행
// 1: 느리게(잘 때)  2: 안정  3: 걷기  4: 운동 (속도 바꾸기)   q: 종료

#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <conio.h>
#include <windows.h>
#else
#include <unistd.h>
#endif

// ───────────────────────── 콘솔 도구 ─────────────────────────
enum Color { GRAY = 8, NORMAL = 7, BLUE = 9, CYAN = 11, RED = 12, YELLOW = 14, WHITE = 15 };

void gotoxy(int x, int y) {
#ifdef _WIN32
    COORD pos = {(SHORT)x, (SHORT)y};
    SetConsoleCursorPosition(GetStdHandle(STD_OUTPUT_HANDLE), pos);
#else
    std::printf("\033[%d;%dH", y + 1, x + 1);
#endif
}

void setColor(int c) {
#ifdef _WIN32
    std::fflush(stdout);
    SetConsoleTextAttribute(GetStdHandle(STD_OUTPUT_HANDLE), (WORD)c);
#else
    const char* code = "\033[0m";
    switch (c) {
        case GRAY:   code = "\033[90m"; break;
        case BLUE:   code = "\033[94m"; break;
        case CYAN:   code = "\033[96m"; break;
        case RED:    code = "\033[91m"; break;
        case YELLOW: code = "\033[93m"; break;
        case WHITE:  code = "\033[97m"; break;
    }
    std::printf("%s", code);
#endif
}

void sleepMs(int ms) {
#ifdef _WIN32
    Sleep(ms);
#else
    std::fflush(stdout);
    usleep(ms * 1000);
#endif
}

void hideCursor() {
#ifdef _WIN32
    CONSOLE_CURSOR_INFO info = {1, FALSE};
    SetConsoleCursorInfo(GetStdHandle(STD_OUTPUT_HANDLE), &info);
#else
    std::printf("\033[?25l");
#endif
}

void clearScreen() {
#ifdef _WIN32
    std::system("cls");
#else
    std::printf("\033[2J");
#endif
}

// 눌린 키를 돌려줌 (안 눌렸으면 0)
int readKey() {
#ifdef _WIN32
    if (_kbhit()) return _getch();
#endif
    return 0;
}

void putText(int x, int y, const std::string& s, int color) {
    gotoxy(x, y);
    setColor(color);
    std::printf("%s", s.c_str());
}

// ───────────────────────── 지도 (배경) ─────────────────────────
const int W = 70;
const int H = 24;

struct Point {
    int x, y;
    Point(int x_ = 0, int y_ = 0) : x(x_), y(y_) {}
};

struct Box {
    int x1, y1, x2, y2;
    std::string label;
    int labelColor;
};

char grid[H][W];  // 배경 글자 (점이 지나간 자리를 되돌릴 때 사용)

// 꼭짓점들을 잇는 길 위의 모든 칸을 순서대로 만든다
std::vector<Point> buildPath(const Point* v, int n) {
    std::vector<Point> path;
    for (int i = 0; i + 1 < n; ++i) {
        int x = v[i].x, y = v[i].y;
        int dx = (v[i + 1].x > x) - (v[i + 1].x < x);
        int dy = (v[i + 1].y > y) - (v[i + 1].y < y);
        while (x != v[i + 1].x || y != v[i + 1].y) {
            path.push_back(Point(x, y));
            x += dx;
            y += dy;
        }
    }
    return path;
}

void drawBox(const Box& b) {
    for (int x = b.x1; x <= b.x2; ++x) grid[b.y1][x] = grid[b.y2][x] = '-';
    for (int y = b.y1; y <= b.y2; ++y) grid[y][b.x1] = grid[y][b.x2] = '|';
    grid[b.y1][b.x1] = grid[b.y1][b.x2] = grid[b.y2][b.x1] = grid[b.y2][b.x2] = '+';
}

// 가운데 뛰는 심장 (커졌다 작아졌다)
void drawHeart(bool big) {
    static const char* bigHeart[5] = {
        " ,d88b.d88b, ",
        " 88888888888 ",
        " `Y8888888Y' ",
        "   `Y888Y'   ",
        "     `Y'     ",
    };
    static const char* smallHeart[5] = {
        "             ",
        "   ,db.db,   ",
        "   `Y888Y'   ",
        "     `Y'     ",
        "             ",
    };
    setColor(RED);
    for (int i = 0; i < 5; ++i) {
        gotoxy(25, 7 + i);
        std::printf("%s", big ? bigHeart[i] : smallHeart[i]);
    }
    putText(29, 12, big ? "쿵쾅!" : "     ", YELLOW);
}

// 활동 상태마다 피가 흐르는 속도와 심장 박동 간격이 다름
struct Mode {
    const char* name;
    int frameMs;    // 한 칸 움직이는 데 걸리는 시간 (작을수록 빠름)
    int beatEvery;  // 몇 프레임마다 한 번 뛰는지
    int color;      // 상태 글자 색
};

const int MODE_COUNT = 4;
const Mode MODES[MODE_COUNT] = {
    {"느리게 (잘 때)", 110, 12, BLUE},    // 약 45회/분
    {"안정", 84, 12, CYAN},               // 약 60회/분
    {"걷기", 70, 10, YELLOW},             // 약 86회/분
    {"운동", 50, 8, RED},                 // 약 150회/분
};

bool onBorder(const Box& b, const Point& p) {
    bool inside = p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;
    return inside && (p.x == b.x1 || p.x == b.x2 || p.y == b.y1 || p.y == b.y2);
}

int main() {
    // 상자: 폐, 심장 4개의 방, 온몸
    Box boxes[] = {
        {18, 0, 45, 3, "폐 (가스 교환)", CYAN},
        {6, 8, 20, 11, "우심방", WHITE},
        {6, 12, 20, 15, "우심실", WHITE},
        {42, 8, 56, 11, "좌심방", WHITE},
        {42, 12, 56, 15, "좌심실", WHITE},
        {22, 19, 41, 22, "온몸 (조직)", YELLOW},
    };
    const int boxCount = sizeof(boxes) / sizeof(boxes[0]);

    // 혈액이 도는 길 (좌심실에서 출발해서 한 바퀴)
    Point vertices[] = {
        Point(50, 14),  // 좌심실
        Point(60, 14),  // 대동맥
        Point(60, 21),
        Point(3, 21),   // 온몸 통과 → 대정맥
        Point(3, 10),
        Point(17, 10),  // 우심방
        Point(17, 14),  // 삼첨판 → 우심실
        Point(22, 14),  // 폐동맥
        Point(22, 2),
        Point(40, 2),   // 폐 통과
        Point(40, 10),  // 폐정맥
        Point(50, 10),  // 좌심방
        Point(50, 14),  // 이첨판 → 좌심실 (출발점으로 돌아옴)
    };
    std::vector<Point> path = buildPath(vertices, sizeof(vertices) / sizeof(vertices[0]));
    const int len = (int)path.size();

    // 온몸 한가운데를 지나면 정맥혈, 폐 한가운데를 지나면 동맥혈
    int bodyMid = 0, lungMid = 0;
    for (int i = 0; i < len; ++i) {
        if (path[i].x == 31 && path[i].y == 21) bodyMid = i;
        if (path[i].x == 32 && path[i].y == 2) lungMid = i;
    }

    // 배경 만들기: 혈관(화살표) → 상자 → 판막(=)
    for (int y = 0; y < H; ++y)
        for (int x = 0; x < W; ++x) grid[y][x] = ' ';
    for (int i = 0; i < len; ++i) {
        const Point& a = path[i];
        const Point& b = path[(i + 1) % len];
        char c = b.x > a.x ? '>' : b.x < a.x ? '<' : b.y > a.y ? 'v' : '^';
        grid[a.y][a.x] = c;
    }
    for (int i = 0; i < boxCount; ++i) drawBox(boxes[i]);
    for (int i = 0; i < len; ++i)
        for (int j = 0; j < boxCount; ++j)
            if (onBorder(boxes[j], path[i])) grid[path[i].y][path[i].x] = '=';

    clearScreen();
    hideCursor();
    setColor(GRAY);
    for (int y = 0; y < H; ++y) {
        gotoxy(0, y);
        std::printf("%.*s", W, grid[y]);
    }

    // 이름표 (길과 겹치지 않는 자리에 둠)
    for (int i = 0; i < boxCount; ++i)
        putText(boxes[i].x1 + 2, boxes[i].y1 + 1, boxes[i].label, boxes[i].labelColor);
    putText(62, 17, "대동맥", RED);
    putText(5, 17, "대정맥", BLUE);
    putText(15, 6, "폐동맥", BLUE);
    putText(42, 6, "폐정맥", RED);
    putText(0, H, "O 빨강 = 동맥혈(산소 많음)   O 파랑 = 정맥혈(산소 적음)   = 은 판막", NORMAL);
    putText(0, H + 1, "1: 느리게(잘 때)   2: 안정   3: 걷기   4: 운동   q: 종료", GRAY);

    // 애니메이션: 점들이 길을 따라 한 칸씩 이동
    const int dots = len / 3;  // 점 개수 (약 3칸 간격)
    int mode = 1;  // 안정에서 시작
    int beats = 0;
    int beatTimer = 0;
    for (int frame = 0;; ++frame) {
        int key = readKey();
        if (key == 'q' || key == 'Q' || key == 27) break;  // 27 = ESC
        if (key >= '1' && key < '1' + MODE_COUNT) mode = key - '1';
#ifndef _WIN32
        if (frame > 200) break;  // Windows가 아니면 키 입력 대신 일정 시간 후 종료
#endif
        const Mode& m = MODES[mode];
        // 지난 프레임의 점 지우기 (배경 글자로 되돌림)
        setColor(GRAY);
        for (int i = 0; i < dots; ++i) {
            int k = (i * len / dots + frame - 1 + len) % len;
            gotoxy(path[k].x, path[k].y);
            std::putchar(grid[path[k].y][path[k].x]);
        }
        // 새 위치에 점 그리기
        for (int i = 0; i < dots; ++i) {
            int k = (i * len / dots + frame) % len;
            bool arterial = k < bodyMid || k >= lungMid;
            setColor(arterial ? RED : BLUE);
            gotoxy(path[k].x, path[k].y);
            std::putchar('O');
        }

        // 심장 박동 표시 (beatEvery 프레임마다 심장이 커지며 "쿵쾅!")
        if (beatTimer == 0) ++beats;
        drawHeart(beatTimer < 3);
        beatTimer = (beatTimer + 1) % m.beatEvery;

        char buf[64];
        std::sprintf(buf, "심장 박동: %d회", beats);
        putText(25, 17, buf, WHITE);
        std::sprintf(buf, "상태: %s (약 %d회/분)", m.name, 60000 / (m.frameMs * m.beatEvery));
        putText(21, 18, std::string(36, ' '), m.color);  // 이전 글자 지우기 (x=21~56)
        putText(21, 18, buf, m.color);

        gotoxy(0, H + 2);
        std::fflush(stdout);
        sleepMs(m.frameMs);
    }

    setColor(NORMAL);
    gotoxy(0, H + 2);
    std::printf("\n");
    return 0;
}
