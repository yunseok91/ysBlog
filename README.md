# 네이버 블로그 자동화 (Electron)

GPT로 블로그 글을 생성하고, 네이버 SmartEditor에 자동으로 입력·발행하는 데스크톱 프로그램.

## 주요 기능
- 🔐 네이버 로그인 자동화 (사람처럼 키 입력) → 글쓰기 페이지 자동 이동
- ✍️ GPT 글 생성 (blog.md 스타일, 사진 분석/배치, 별점·한줄평, 태그, 카테고리 추천, 분량 제어)
- 🖼️ 사진 업로드(리사이즈·회전보정) + 설명별 위치 매핑
- 📝 SmartEditor 자동 입력 (제목/본문/소제목 굵게/사진/색상)
- 🛒 네이버 쇼핑 커넥트 (공정위 문구 + 상품 링크 자동 삽입)
- 🚀 카테고리/태그/공개설정/발행 자동화

## 설치 및 실행
```bash
git clone https://github.com/yunseok91/ysBlog.git
cd ysBlog
npm install

# .env 파일을 만들고 API 키 등을 채운다
copy .env.example .env   # Windows
# cp .env.example .env    # Mac/Linux
#  → .env 의 OPENAI_API_KEY 에 본인 키 입력

npm start
```

## 환경 변수 (.env)
| 키 | 설명 |
|---|---|
| `OPENAI_API_KEY` | OpenAI(GPT) API 키 (필수, 없으면 글 생성 불가) |
| `OPENAI_MODEL` | 사용할 모델 (기본 `gpt-4o-mini`) |
| `NAVER_BLOG_ID` | 네이버 블로그 아이디 |

> `.env` 와 `default.env` 는 키가 들어있어 git 에 올라가지 않습니다. 받는 PC마다 직접 만들어야 합니다.

## 실행 파일(.exe) 빌드 (Windows)
```bash
npm run dist
# → dist/네이버블로그자동화-win32-x64/네이버블로그자동화.exe
```
exe 는 첫 실행 시 옆에 `.env` / `blog.md` 를 자동 생성합니다.
