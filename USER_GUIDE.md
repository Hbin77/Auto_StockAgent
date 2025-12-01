# 📈 자동 주식 매매 에이전트 실행 가이드

이 가이드는 나스닥 100 및 S&P 500 종목을 분석하고 한국투자증권(KIS) API를 통해 자동으로 매매하는 에이전트의 설치 및 실행 방법을 설명합니다.

## 1. 사전 준비 사항

*   **Node.js**: 최신 LTS 버전이 설치되어 있어야 합니다.
*   **한국투자증권(KIS) 계좌 및 API Key**:
    *   실전 투자용 또는 모의 투자용 API Key가 필요합니다.
    *   [한국투자증권 개발자 센터](https://apiportal.koreainvestment.com/)에서 신청 가능합니다.

## 2. 설치 (Installation)

터미널에서 프로젝트 폴더로 이동한 후 의존성 패키지를 설치합니다.

```bash
cd /Users/baghyeonbin/auto_stock
npm install
```

## 3. 설정 (Configuration)

API 키와 매매 모드를 설정해야 합니다.

1.  `.env.example` 파일을 복사하여 `.env` 파일을 생성합니다.

    ```bash
    cp .env.example .env
    ```

2.  `.env` 파일을 열어 본인의 정보를 입력합니다.

    ```ini
    # 한국투자증권 API 정보
    KIS_APP_KEY=여기에_APP_KEY_입력
    KIS_APP_SECRET=여기에_APP_SECRET_입력
    KIS_ACCOUNT_NO=계좌번호_8자리
    KIS_ACCOUNT_CODE=계좌상품코드_2자리 (보통 01)

    # API 주소 설정 (모의투자는 아래 주소 유지, 실전투자는 주석 참고)
    # 실전투자: https://openapi.koreainvestment.com:9443
    # 모의투자: https://openapivts.koreainvestment.com:29443
    KIS_BASE_URL=https://openapivts.koreainvestment.com:29443

    # 매매 모드 설정
    # REAL: 실전 매매 (주문 전송됨)
    # PAPER: 모의 매매 또는 테스트 (로그만 남김)
    TRADING_MODE=PAPER
    ```

    > **주의**: `TRADING_MODE=REAL`로 설정하면 실제로 주문이 나갑니다. 충분히 테스트 후 변경하세요.

## 4. 실행 (Running)

에이전트를 실행하면 5분마다 시장 데이터를 분석하고 매매를 수행합니다.

```bash
node index.js
```

실행 시 다음과 같은 로그가 출력됩니다:
*   `Auto Stock Agent Started`
*   `Starting Trading Cycle...`
*   각 종목별 분석 점수 및 매매 신호 (BUY/SELL/HOLD)

## 5. 로그 확인

*   **콘솔(터미널)**: 실시간 진행 상황이 출력됩니다.
*   **trade.log**: 매매 로직 및 신호 발생 내역이 파일로 저장됩니다.
*   **kis-api.log**: API 호출 관련 에러나 정보가 저장됩니다.

## 6. 종료 방법

실행 중인 터미널에서 `Ctrl + C`를 누르면 종료됩니다.

---

## 💡 주요 기능 요약

*   **대상 종목**: Nasdaq 100, S&P 500 주요 종목 (설정에서 변경 가능)
*   **분석 주기**: 5분
*   **매수 조건**: 기술적 지표(MA, RSI, MACD 등) + 펀더멘털 점수 종합 80점 이상 (STRONG_BUY)
*   **매도 조건**: 종합 점수 30점 이하 (SELL) 또는 손절/익절 조건 도달 시
