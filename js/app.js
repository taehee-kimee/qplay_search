// Feature Flags 및 Workers 통합
// 주의: 브라우저에서 직접 TypeScript 모듈을 로드할 수 없으므로
// JavaScript로 변환된 버전을 사용하거나 번들러가 필요합니다.
// 여기서는 간단한 Feature Flag만 구현합니다.

const params = new URLSearchParams(location.search);
const storage = typeof localStorage !== 'undefined' ? localStorage : null;

const FEATURES = {
    enableOcrPool: params.get('ocr_pool') === '1' || storage?.getItem('qplay:ocr_pool') === '1' || true,
    enableFastSearch: params.get('fast') === '1' || storage?.getItem('qplay:fastsearch') === '1' || false,
    enableShadowTest: params.get('shadow') === '1' || storage?.getItem('qplay:shadow_test') === '1' || false,
    enableTelemetry: params.get('telemetry') === '1' || storage?.getItem('qplay:telemetry') === '1' || false,
    maxConcurrentOcr: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? 1 : 2
};

window.QPLAY_FEATURES = FEATURES;

// Workers 초기화 (기본적으로 비활성화, 필요시 활성화)
let ocrWorker = null;
let searchWorker = null;
let searchIndexBuilt = false;

async function initWorkers() {
    if (!FEATURES.enableOcrPool && !FEATURES.enableFastSearch) {
        return;
    }

    try {
        if (FEATURES.enableOcrPool && typeof Worker !== 'undefined') {
            ocrWorker = new Worker('workers/ocr.worker.ts');
            ocrWorker.postMessage({ type: 'get-flags', id: 'init' });
        }

        if (FEATURES.enableFastSearch && typeof Worker !== 'undefined') {
            searchWorker = new Worker('workers/search.worker.ts');
            searchWorker.postMessage({ type: 'get-flags', id: 'init' });
        }
    } catch (error) {
        console.warn('Workers 초기화 실패, 기존 방식 사용:', error);
    }
}

// 검색 인덱스 구축
async function buildSearchIndex() {
    if (!searchWorker || !FEATURES.enableFastSearch || searchIndexBuilt) {
        return;
    }

    try {
        const documents = (window.questionsData || []).map((item, index) => ({
            id: String(index),
            text: (item.question || '') + ' ' + (item.answer || ''),
            payload: item
        }));

        if (documents.length === 0) {
            return;
        }

        searchWorker.postMessage({
            type: 'build-index',
            id: 'build-' + Date.now(),
            documents,
            timeout: 10000
        });

        const handler = (event) => {
            if (event.data.type === 'index-ready') {
                searchIndexBuilt = true;
                console.log('검색 인덱스 구축 완료:', event.data.size);
                searchWorker.removeEventListener('message', handler);
            }
        };
        searchWorker.addEventListener('message', handler);
    } catch (error) {
        console.warn('검색 인덱스 구축 실패:', error);
    }
}

// Telemetry 로깅 (간단한 버전)
function logTelemetry(event) {
    if (!FEATURES.enableTelemetry) {
        return;
    }

    try {
        const eventData = {
            ...event,
            timestamp: Date.now(),
            userAgent: navigator.userAgent
        };

        // 로컬 스토리지에 버퍼링 (실제로는 서버로 전송)
        const buffer = JSON.parse(localStorage.getItem('qplay:telemetry_buffer') || '[]');
        buffer.push(eventData);
        if (buffer.length > 100) {
            buffer.shift();
        }
        localStorage.setItem('qplay:telemetry_buffer', JSON.stringify(buffer));
    } catch (error) {
        console.warn('Telemetry 로깅 실패:', error);
    }
}

window.initWorkers = initWorkers;
window.buildSearchIndex = buildSearchIndex;
window.logTelemetry = logTelemetry;
window.ocrWorker = ocrWorker;
window.searchWorker = searchWorker;

// 페이지 로드 시 Workers 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initWorkers().then(() => {
            if (window.questionsData && window.questionsData.length > 0) {
                buildSearchIndex();
            }
        });
    });
} else {
    initWorkers().then(() => {
        if (window.questionsData && window.questionsData.length > 0) {
            buildSearchIndex();
        }
    });
}

// Toast 공지 팝업 기능
const noticeToastOverlay = document.getElementById('noticeToastOverlay');
const noticeToast = document.getElementById('noticeToast');
const noticeToastClose = document.getElementById('noticeToastClose');
const noticeToastContent = document.getElementById('noticeToastContent');

// 공지 내용의 해시값 계산 (간단한 해시 함수)
function calculateContentHash(content) {
    let hash = 0;
    if (!content) return '0';
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 32bit 정수로 변환
    }
    return Math.abs(hash).toString(36);
}

// 마크다운을 HTML로 변환 (필요시 사용)
function markdownToHtml(markdown) {
    let html = markdown;

    // 제목 변환
    html = html.replace(/^### (.*?)$/gm, '<strong style="font-size: 1.1em; color: #333;">$1</strong>');
    html = html.replace(/^## (.*?)$/gm, '<strong style="font-size: 1.2em; color: #333;">$1</strong>');
    html = html.replace(/^# (.*?)$/gm, '<strong style="font-size: 1.3em; color: #333;">$1</strong>');

    // 굵은 텍스트
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

    // 기울임
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 줄바꿈
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // 리스트 변환
    html = html.replace(/<p>- (.*?)<\/p>/g, '<ul style="margin-left: 20px;"><li>$1</li></ul>');
    html = html.replace(/<p>\d+\. (.*?)<\/p>/g, '<ol style="margin-left: 20px;"><li>$1</li></ol>');

    // 구분선
    html = html.replace(/---/g, '<hr style="border: none; height: 1px; background: #e0e0e0; margin: 16px 0;">');

    return html;
}

// 공지 팝업 표시 (내용 해시 확인)
function showNoticeToast() {
    if (!noticeToast || !noticeToastOverlay || !noticeToastContent) return;

    // 공지 내용 가져오기
    const content = noticeToastContent.textContent || noticeToastContent.innerText || '';
    const contentHash = calculateContentHash(content);

    // 저장된 해시값과 비교
    const savedHash = localStorage.getItem('noticeToastContentHash');

    // 내용이 변경되었거나 처음 보는 경우 표시
    if (savedHash !== contentHash) {
        noticeToastOverlay.classList.add('show');
        noticeToast.classList.add('show');
    }
}

// 공지 팝업 닫기
function closeNoticeToast() {
    if (noticeToast && noticeToastOverlay && noticeToastContent) {
        noticeToast.classList.remove('show');
        noticeToastOverlay.classList.remove('show');

        // 현재 공지 내용의 해시값 저장
        const content = noticeToastContent.textContent || noticeToastContent.innerText || '';
        const contentHash = calculateContentHash(content);
        localStorage.setItem('noticeToastContentHash', contentHash);
    }
}

// 이벤트 리스너
if (noticeToastClose) {
    noticeToastClose.addEventListener('click', closeNoticeToast);
}

// 배경 클릭 시 닫기
if (noticeToastOverlay) {
    noticeToastOverlay.addEventListener('click', closeNoticeToast);
}

// 페이지 로드 시 공지 표시
window.addEventListener('DOMContentLoaded', showNoticeToast);

let questionsData = [];
window.questionsData = questionsData; // Workers에서 접근 가능하도록
let currentSearchTerm = '';
let allSheetNames = [];
let selectedSheet = null; // 단일 선택으로 변경
let autoCopyEnabled = false;
let autoJokboEnabled = false;
let maxResults = 10; // 기본값 10개
let displayedCount = 0;
let allFilteredResults = [];
let debounceTimer = null;
let currentSearchRequestId = null;

// JSON 데이터 처리 함수
function processJsonData(jsonData) {
    try {
        questionsData = jsonData.data || [];
        window.questionsData = questionsData; // Workers에서 접근 가능하도록
        allSheetNames = jsonData.metadata?.sheets || [];

        // 시트 이름 추출 (데이터에서 고유한 시트 이름 찾기)
        if (allSheetNames.length === 0) {
            const uniqueSheets = new Set(jsonData.data.map(item => item.sheet));
            allSheetNames = Array.from(uniqueSheets);
        }

        // 초기화: 첫 번째 시트 선택
        selectedSheet = allSheetNames.length > 0 ? allSheetNames[0] : null;

        // 카테고리 선택 UI 생성
        createCategoryFilters();

        document.getElementById('searchInput').disabled = false;
        document.getElementById('cameraBtn').disabled = false;
        const totalCount = selectedSheet
            ? questionsData.filter(item => item.sheet === selectedSheet).length
            : questionsData.length;

        // 카테고리 정보 표시
        let categoryInfo = '';
        if (allSheetNames && allSheetNames.length > 0) {
            categoryInfo = ` (사용 가능한 카테고리: ${allSheetNames.join(', ')})`;
        }

        document.getElementById('results').innerHTML =
            `<div class="results-count">총 ${totalCount}개의 문제가 로드되었습니다. ${selectedSheet ? `(현재 카테고리: ${selectedSheet})` : ''}${categoryInfo} 검색어를 입력하여 검색해보세요.</div>`;
    } catch (error) {
        document.getElementById('categorySection').classList.remove('active');
        document.getElementById('results').innerHTML =
            `<div class="error">데이터를 읽는 중 오류가 발생했습니다: ${error.message}</div>`;
        document.getElementById('searchInput').disabled = true;
    }
}

// Excel 파일 처리 함수
function processExcelFile(fileData) {
    try {
        const data = new Uint8Array(fileData);
        const workbook = XLSX.read(data, { type: 'array' });

        // 모든 시트 읽기
        questionsData = [];
        allSheetNames = workbook.SheetNames;

        // 각 시트를 순회하며 데이터 읽기
        allSheetNames.forEach((sheetName, sheetIndex) => {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            const sheetData = parseExcelData(jsonData, sheetName);

            // 시트 이름을 포함하여 데이터 추가
            questionsData = questionsData.concat(sheetData);
        });

        // 초기화: 첫 번째 시트 선택
        selectedSheet = allSheetNames.length > 0 ? allSheetNames[0] : null;

        // 카테고리 선택 UI 생성
        createCategoryFilters();

        document.getElementById('searchInput').disabled = false;
        document.getElementById('cameraBtn').disabled = false;
        const totalCount = selectedSheet
            ? questionsData.filter(item => item.sheet === selectedSheet).length
            : questionsData.length;

        // 카테고리 정보 표시
        let categoryInfo = '';
        if (allSheetNames && allSheetNames.length > 0) {
            categoryInfo = ` (사용 가능한 카테고리: ${allSheetNames.join(', ')})`;
        }

        document.getElementById('results').innerHTML =
            `<div class="results-count">총 ${totalCount}개의 문제가 로드되었습니다. ${selectedSheet ? `(현재 카테고리: ${selectedSheet})` : ''}${categoryInfo} 검색어를 입력하여 검색해보세요.</div>`;
    } catch (error) {
        document.getElementById('categorySection').classList.remove('active');
        document.getElementById('results').innerHTML =
            `<div class="error">파일을 읽는 중 오류가 발생했습니다: ${error.message}</div>`;
        document.getElementById('searchInput').disabled = true;
    }
}


// 로드된 카테고리 데이터 캐시
let loadedCategories = {};

// 카테고리 데이터 로드 (지연 로딩)
async function loadCategoryData(categoryId) {
    // 이미 로드된 경우 캐시에서 반환
    if (loadedCategories[categoryId]) {
        console.log(`✅ 캐시에서 ${categoryId} 로드`);
        return loadedCategories[categoryId];
    }

    try {
        console.log(`📥 ${categoryId} 로드 중...`);
        const response = await fetch(`categories/${categoryId}.json`);
        if (!response.ok) {
            throw new Error(`${categoryId}.json을 찾을 수 없습니다.`);
        }
        const data = await response.json();
        loadedCategories[categoryId] = data.data;
        console.log(`✅ ${categoryId} 로드 완료: ${data.data.length}개`);
        return data.data;
    } catch (error) {
        console.error(`❌ ${categoryId} 로드 실패:`, error);
        throw error;
    }
}

// 메타데이터 로드 및 카테고리 초기화
async function loadDefaultData() {
    document.getElementById('results').innerHTML = '<div class="loading">메타데이터를 로드하는 중...</div>';
    document.getElementById('searchInput').disabled = true;

    try {
        // metadata.json 로드
        console.log('📂 metadata.json 로드 중...');
        const response = await fetch('metadata.json');
        if (!response.ok) {
            throw new Error('metadata.json을 찾을 수 없습니다.');
        }
        const metadata = await response.json();

        // 카테고리 목록 저장
        allSheetNames = metadata.categories.map(cat => cat.name);
        selectedSheet = allSheetNames.length > 0 ? allSheetNames[0] : null;

        console.log(`✅ 메타데이터 로드: ${allSheetNames.length}개 카테고리`);

        // 첫 번째 카테고리 데이터 로드 (빠른 초기 로드)
        if (selectedSheet) {
            const categoryObj = metadata.categories.find(cat => cat.name === selectedSheet);
            if (categoryObj) {
                const categoryData = await loadCategoryData(categoryObj.id);
                questionsData = categoryData;
                window.questionsData = questionsData;
            }
        }

        // 카테고리 선택 UI 생성
        createCategoryFilters();

        document.getElementById('searchInput').disabled = false;
        document.getElementById('cameraBtn').disabled = false;
        const totalCount = selectedSheet
            ? questionsData.length
            : 0;

        // 카테고리 정보 표시
        let categoryInfo = '';
        if (allSheetNames && allSheetNames.length > 0) {
            categoryInfo = ` (사용 가능한 카테고리: ${allSheetNames.join(', ')})`;
        }

        document.getElementById('results').innerHTML =
            `<div class="results-count">총 ${metadata.total_items.toLocaleString()}개의 문제가 준비되어 있습니다. ${selectedSheet ? `(현재 카테고리: ${selectedSheet} - ${totalCount.toLocaleString()}개)` : ''}${categoryInfo} 검색어를 입력하여 검색해보세요.</div>`;

        // 검색 인덱스 구축 (Fast Search 활성화 시)
        if (window.buildSearchIndex) {
            window.buildSearchIndex();
        }

        // 카테고리 변경 시 해당 데이터 로드
        window.onCategoryChange = async function (categoryName) {
            const categoryObj = metadata.categories.find(cat => cat.name === categoryName);
            if (categoryObj) {
                try {
                    document.getElementById('results').innerHTML = `<div class="loading">${categoryName} 데이터를 로드하는 중...</div>`;
                    const categoryData = await loadCategoryData(categoryObj.id);
                    questionsData = categoryData;
                    window.questionsData = questionsData;

                    // 검색 인덱스 재구축
                    if (window.buildSearchIndex) {
                        window.buildSearchIndex();
                    }

                    // 검색 수행
                    performSearch(true);
                } catch (error) {
                    document.getElementById('results').innerHTML =
                        `<div class="error">${categoryName} 데이터를 로드할 수 없습니다: ${error.message}</div>`;
                    console.error(error);
                }
            }
        };

    } catch (error) {
        console.error('데이터 로드 실패:', error);
        document.getElementById('results').innerHTML =
            `<div class="no-results" style="text-align: center; padding: 40px;">
                        <h3 style="margin-bottom: 20px; color: #000000;">Qplay 족보에 오신 것을 환영합니다!</h3>
                        <p style="font-size: 1.1em; margin-bottom: 15px;">데이터를 로드할 수 없습니다.</p>
                        <p style="color: #666;">metadata.json 파일이 필요합니다. 파일 구조: metadata.json, categories/*.json</p>
                        <p style="color: #999; font-size: 0.9em; margin-top: 20px;"><code>${error.message}</code></p>
                    </div>`;
        document.getElementById('searchInput').disabled = false;
        document.getElementById('cameraBtn').disabled = false;
        document.getElementById('categorySelect').disabled = false;
    }
}

// 페이지 로드 시 자동으로 기본 파일 로드 시도
window.addEventListener('DOMContentLoaded', function () {
    // 로컬 서버 환경인지 확인 (http:// 또는 https://로 시작하는지)
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        // 웹 서버 환경에서는 자동 로드 시도 (JSON)
        loadDefaultData();
    } else {
        // file:// 프로토콜인 경우 안내 및 카테고리 초기화
        document.getElementById('results').innerHTML =
            `<div class="no-results" style="text-align: center; padding: 40px;">
                        <h3 style="margin-bottom: 20px; color: #667eea;">📚 Qplay 족보에 오신 것을 환영합니다!</h3>
                        <p style="font-size: 1.1em; margin-bottom: 15px;">데이터를 로드하려면 로컬 웹 서버를 사용해주세요.</p>
                        <p style="color: #666;">로컬 서버를 실행하려면 터미널에서 다음 명령어를 실행하세요:</p>
                        <p style="color: #999; font-size: 0.9em; margin-top: 20px;">💡 <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 4px;">python -m http.server 8000</code></p>
                    </div>`;
        // 카테고리 섹션 표시 (로컬 파일이면 카테고리는 비활성)
        document.getElementById('categorySection').classList.remove('active');
    }
});

// Excel 데이터 파싱
function parseExcelData(jsonData, sheetName) {
    if (!jsonData || jsonData.length === 0) return [];

    const data = [];

    // 첫 번째 행이 헤더인지 확인
    const firstRow = jsonData[0];
    let hasHeader = false;
    let questionCol = 0;
    let answerCol = 1;

    // 자동으로 문제/답 컬럼 찾기
    if (firstRow && firstRow.length > 0) {
        const headers = firstRow.map(h => String(h || '').toLowerCase());

        // 헤더에서 문제/답 컬럼 찾기
        const questionKeywords = ['문제', 'question', '질문', '문항', '문제내용', '문항내용', '내용'];
        const answerKeywords = ['답', 'answer', '정답', '해답', '답안', '해설', '정답내용'];

        headers.forEach((h, idx) => {
            if (questionKeywords.some(k => h.includes(k))) {
                questionCol = idx;
                hasHeader = true;
            }
            if (answerKeywords.some(k => h.includes(k))) {
                answerCol = idx;
                hasHeader = true;
            }
        });

        // 헤더가 없으면 첫 번째 열을 문제, 두 번째 열을 답으로 간주
        if (!hasHeader) {
            questionCol = 0;
            answerCol = 1;
        }
    }

    // 데이터 행 처리
    const startRow = hasHeader ? 1 : 0;
    for (let i = startRow; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;

        const question = String(row[questionCol] || '').trim();
        const answer = String(row[answerCol] || '').trim();

        if (question) {
            data.push({
                question: question,
                answer: answer || '답이 없습니다.',
                index: i - startRow + 1,
                sheet: sheetName || '알 수 없음'
            });
        }
    }

    return data;
}

// Notification 표시 함수
function showNotification(message) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.classList.add('show');

    // 2초 후 자동으로 사라지기
    setTimeout(() => {
        notification.classList.remove('show');
    }, 2000);
}

// 자동복사 기능
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => {
            showNotification('답이 복사되었습니다');
            return true;
        }).catch(err => {
            console.error('클립보드 복사 실패:', err);
            return false;
        });
    } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showNotification('답이 복사되었습니다');
            return Promise.resolve(true);
        } catch (err) {
            document.body.removeChild(textArea);
            console.error('클립보드 복사 실패:', err);
            return Promise.resolve(false);
        }
    }
}

// 카메라 관련 변수
let cameraStream = null;
let cameraModal = null;
let cameraVideo = null;
let cameraBtn = null;
let cameraCaptureBtn = null;
let cameraCloseBtn = null;
let cameraLoading = null;
let cameraContinueCheckbox = null;
let cameraMinimizeBtn = null;
let cameraMaximizeBtn = null;
let cameraCloseBtnHeader = null;

// 드래그 관련 변수
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let modalStartLeft = 0;
let modalStartTop = 0;

// 영역 선택 관련 변수
let isSelecting = false;
let selectionStart = { x: 0, y: 0 };
let selectionEnd = { x: 0, y: 0 };
let selectionBox = null;

// 자동 캡처 관련 변수
let autoCaptureInterval = null;
let isAutoCaptureMode = false;
let lastOCRText = '';
let savedSelectionRect = null;

// 모든 이벤트 리스너 초기화 함수
function initEventListeners() {
    // 문제 제보 및 도움말 모달 관련 요소
    const reportBtn = document.getElementById('reportBtn');
    const reportModal = document.getElementById('reportModal');
    const reportModalOverlay = document.getElementById('reportModalOverlay');
    const reportModalClose = document.getElementById('reportModalClose');
    const reportBtnCancel = document.getElementById('reportBtnCancel');
    const reportBtnSubmit = document.getElementById('reportBtnSubmit');
    const reportForm = document.getElementById('reportForm');
    const reportSuccessMessage = document.getElementById('reportSuccessMessage');

    const helpBtn = document.getElementById('helpBtn');
    const helpModal = document.getElementById('helpModal');
    const helpModalOverlay = document.getElementById('helpModalOverlay');
    const helpModalClose = document.getElementById('helpModalClose');

    // 디스코드 웹훅 URL (사용자 제공)
    const DISCORD_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1456287573365227582/tcHV62OGRYho5kNYZ1TLMdR4RwxM3He0TtnVOGH0k-cO-bKfUylnrZonGeOpKOi67zBW';

    // 문제 제보 모달 열기
    if (reportBtn && reportModal && reportModalOverlay) {
        reportBtn.addEventListener('click', () => {
            reportModal.classList.add('show');
            reportModalOverlay.classList.add('show');
        });
    }

    // 문제 제보 모달 닫기 함수
    const closeReportModal = () => {
        if (reportModal && reportModalOverlay) {
            reportModal.classList.remove('show');
            reportModalOverlay.classList.remove('show');
            // 폼 초기화는 나중에 성공 시에만 하거나, 필요하면 여기서 수행
        }
    };

    if (reportModalClose) reportModalClose.addEventListener('click', closeReportModal);
    if (reportBtnCancel) reportBtnCancel.addEventListener('click', closeReportModal);
    if (reportModalOverlay) reportModalOverlay.addEventListener('click', closeReportModal);

    // 스크린샷 첨부 관련 로직
    const imageDropZone = document.getElementById('imageDropZone');
    const imageInput = document.getElementById('imageInput');
    const imagePreview = document.getElementById('imagePreview');
    let attachedFile = null;

    if (imageDropZone && imageInput) {
        // 클릭하여 파일 선택
        imageDropZone.addEventListener('click', () => imageInput.click());

        // 파일 선택 시 처리
        imageInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleFileSelect(e.target.files[0]);
            }
        });

        // 드래그 앤 드롭 이벤트
        imageDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            imageDropZone.style.borderColor = '#667eea';
            imageDropZone.style.backgroundColor = '#f0f4ff';
        });

        imageDropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            imageDropZone.style.borderColor = '#ddd';
            imageDropZone.style.backgroundColor = '';
        });

        imageDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            imageDropZone.style.borderColor = '#ddd';
            imageDropZone.style.backgroundColor = '';

            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFileSelect(e.dataTransfer.files[0]);
            }
        });

        // 붙여넣기 이벤트 (window 전체에서 감지하거나 모달 내에서 감지)
        document.addEventListener('paste', (e) => {
            if (!reportModal.classList.contains('show')) return;

            if (e.clipboardData && e.clipboardData.items) {
                for (let i = 0; i < e.clipboardData.items.length; i++) {
                    const item = e.clipboardData.items[i];
                    if (item.type.indexOf('image') !== -1) {
                        const file = item.getAsFile();
                        handleFileSelect(file);
                        break;
                    }
                }
            }
        });
    }

    // 파일 선택 처리 함수
    function handleFileSelect(file) {
        if (!file.type.match('image.*')) {
            alert('이미지 파일만 첨부할 수 있습니다.');
            return;
        }

        attachedFile = file;

        // 미리보기 표시
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.innerHTML = `
                <div style="position: relative; display: inline-block;">
                    <img src="${e.target.result}" style="max-width: 100%; max-height: 200px; border-radius: 8px; border: 1px solid #ddd;">
                    <button type="button" id="removeImageBtn" style="position: absolute; top: -10px; right: -10px; background: #ff4444; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center;">×</button>
                </div>
            `;

            // 이미지 삭제 버튼 이벤트
            document.getElementById('removeImageBtn').addEventListener('click', (e) => {
                e.stopPropagation(); // 부모 클릭 방지
                attachedFile = null;
                imageInput.value = ''; // input 초기화
                imagePreview.innerHTML = '';
            });
        };
        reader.readAsDataURL(file);
    }

    // 문제 제보 제출
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const categorySelect = document.getElementById('reportCategory');
            const descriptionInput = document.getElementById('reportDescription');
            const submitBtn = document.getElementById('reportBtnSubmit');

            // 유효성 검사
            if (!categorySelect.value || !descriptionInput.value.trim()) {
                alert('카테고리와 문제 설명을 입력해주세요.');
                return;
            }

            // 로딩 상태 표시
            const originalBtnText = submitBtn.textContent;
            submitBtn.textContent = '제보 중...';
            submitBtn.disabled = true;

            try {
                const formData = new FormData();

                // 디스코드 웹훅 메시지 페이로드 구성
                const payload = {
                    content: `🚨 **새로운 문제 제보가 도착했습니다!**\n\n**카테고리:** ${categorySelect.value}\n**내용:** ${descriptionInput.value}\n**일시:** ${new Date().toLocaleString()}`
                };

                // FormData에 메시지 내용 추가 (payload_json 필드 사용)
                formData.append('payload_json', JSON.stringify(payload));

                // 파일이 있으면 추가
                if (attachedFile) {
                    formData.append('file', attachedFile);
                }

                // 디스코드 웹훅으로 전송
                const response = await fetch(DISCORD_WEBHOOK_URL, {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    // 성공 메시지 표시
                    if (reportSuccessMessage) {
                        reportSuccessMessage.classList.add('show');
                        reportSuccessMessage.style.display = 'block';

                        // 폼 초기화
                        reportForm.reset();
                        attachedFile = null;
                        imagePreview.innerHTML = '';

                        // 2초 후 닫기
                        setTimeout(() => {
                            reportSuccessMessage.style.display = 'none';
                            reportSuccessMessage.classList.remove('show');
                            closeReportModal();
                        }, 2000);
                    }
                } else {
                    throw new Error('전송 실패');
                }
            } catch (error) {
                console.error('제보 전송 실패:', error);
                alert('제보 전송에 실패했습니다. 잠시 후 다시 시도해주세요.');
            } finally {
                // 버튼 상태 복구
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
            }
        });
    }

    // 도움말 모달 열기
    if (helpBtn && helpModal && helpModalOverlay) {
        helpBtn.addEventListener('click', () => {
            helpModal.classList.add('show');
            helpModalOverlay.classList.add('show');
        });
    }

    // 도움말 모달 닫기 함수
    const closeHelpModal = () => {
        if (helpModal && helpModalOverlay) {
            helpModal.classList.remove('show');
            helpModalOverlay.classList.remove('show');
        }
    };

    if (helpModalClose) helpModalClose.addEventListener('click', closeHelpModal);
    if (helpModalOverlay) helpModalOverlay.addEventListener('click', closeHelpModal);
    // 체크박스 이벤트 리스너
    const autoCopyCheckbox = document.getElementById('autoCopyCheckbox');
    if (autoCopyCheckbox) {
        autoCopyCheckbox.addEventListener('change', function (e) {
            autoCopyEnabled = e.target.checked;
        });
    }

    // 자동지우기 체크박스 이벤트 리스너
    const autoClearCheckbox = document.getElementById('autoClearCheckbox');
    if (autoClearCheckbox) {
        autoClearCheckbox.addEventListener('change', function (e) {
            autoClearEnabled = e.target.checked;
        });
    }

    const autoJokboCheckbox = document.getElementById('autoJokboCheckbox');
    if (autoJokboCheckbox) {
        autoJokboCheckbox.addEventListener('change', function (e) {
            autoJokboEnabled = e.target.checked;
            // 모드 변경 시 검색 재실행
            displayedCount = 0;
            performSearch(true);
        });
    }

    // 카메라 관련 요소 초기화
    cameraModal = document.getElementById('cameraModal');
    cameraVideo = document.getElementById('cameraVideo');
    cameraBtn = document.getElementById('cameraBtn');
    cameraCaptureBtn = document.getElementById('cameraCaptureBtn');
    cameraCloseBtn = document.getElementById('cameraCloseBtn');
    cameraContinueCheckbox = document.getElementById('cameraContinueCheckbox');
    cameraLoading = document.getElementById('cameraLoading');
    cameraMinimizeBtn = document.getElementById('cameraMinimizeBtn');
    cameraMaximizeBtn = document.getElementById('cameraMaximizeBtn');
    cameraCloseBtnHeader = document.getElementById('cameraCloseBtnHeader');

    // 카메라 버튼 클릭 이벤트
    if (cameraBtn) {
        cameraBtn.addEventListener('click', function () {
            openCamera();
        });
    }

    // 카메라 닫기 버튼 클릭 이벤트
    if (cameraCloseBtn) {
        cameraCloseBtn.addEventListener('click', function () {
            closeCamera();
        });
    }

    // 최소화 버튼 클릭 이벤트
    if (cameraMinimizeBtn) {
        cameraMinimizeBtn.addEventListener('click', function () {
            toggleMinimize();
        });
    }

    // 최대화 버튼 클릭 이벤트
    if (cameraMaximizeBtn) {
        cameraMaximizeBtn.addEventListener('click', function () {
            toggleMinimize();
        });
    }

    // 헤더 닫기 버튼 클릭 이벤트
    if (cameraCloseBtnHeader) {
        cameraCloseBtnHeader.addEventListener('click', function () {
            closeCamera();
        });
    }

    // 카메라 중단없이 체크박스는 이벤트 리스너 불필요 (상태만 확인)

    // 캡처 버튼 클릭 이벤트
    if (cameraCaptureBtn) {
        cameraCaptureBtn.addEventListener('click', function () {
            if (isAutoCaptureMode) {
                // 자동 모드 중이면 중지
                stopAutoCapture();
            } else {
                // 수동 캡처 시작
                captureAndOCR(false);
            }
        });
    }

    // result-item 클릭 이벤트 리스너 (이벤트 위임)
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) {
        resultsDiv.addEventListener('click', function (e) {
            const resultItem = e.target.closest('.result-item');
            if (resultItem && autoCopyEnabled) {
                const answer = resultItem.getAttribute('data-answer');
                if (answer) {
                    // HTML 엔티티 디코딩
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = answer;
                    const decodedAnswer = tempDiv.textContent || tempDiv.innerText || '';
                    copyToClipboard(decodedAnswer);
                }
            }
        });
    }

    // 출력 개수 드롭다운 이벤트 리스너
    const resultLimitSelect = document.getElementById('resultLimitSelect');
    if (resultLimitSelect) {
        resultLimitSelect.addEventListener('change', function (e) {
            maxResults = parseInt(e.target.value, 10);
            displayedCount = 0; // 리셋
            performSearch();
        });
    }

    // 카메라 모달 드래그 기능 초기화
    initDragFunctionality();
}

// 카메라 모달 드래그 기능 초기화
function initDragFunctionality() {
    const header = document.querySelector('.camera-modal-header');
    if (!header || !cameraModal) return;

    header.addEventListener('mousedown', (e) => {
        // 버튼 클릭은 드래그로 처리하지 않음
        if (e.target.closest('button')) return;

        // 최소화 상태에서는 드래그 비활성화
        if (cameraModal.classList.contains('minimized')) return;

        isDragging = true;
        const rect = cameraModal.getBoundingClientRect();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        modalStartLeft = rect.left;
        modalStartTop = rect.top;

        cameraModal.classList.add('dragging');
        e.preventDefault();
        e.stopPropagation(); // 다른 이벤트와 충돌 방지
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;

        const newLeft = modalStartLeft + deltaX;
        const newTop = modalStartTop + deltaY;

        // 화면 경계 체크
        const maxLeft = window.innerWidth - cameraModal.offsetWidth;
        const maxTop = window.innerHeight - cameraModal.offsetHeight;

        const clampedLeft = Math.max(0, Math.min(newLeft, maxLeft));
        const clampedTop = Math.max(0, Math.min(newTop, maxTop));

        cameraModal.style.left = clampedLeft + 'px';
        cameraModal.style.top = clampedTop + 'px';
        cameraModal.style.right = 'auto';
        cameraModal.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', (e) => {
        if (isDragging) {
            isDragging = false;
            cameraModal.classList.remove('dragging');
        }
    });
}

// 영역 선택 초기화 함수
function initSelectionArea() {
    selectionBox = document.getElementById('selectionBox');
    const videoContainer = document.querySelector('.camera-video-container');

    if (!videoContainer || !selectionBox) return;

    // 마우스 다운 - 선택 시작
    videoContainer.addEventListener('mousedown', (e) => {
        if (!cameraStream) return;
        isSelecting = true;
        const rect = videoContainer.getBoundingClientRect();
        selectionStart.x = e.clientX - rect.left;
        selectionStart.y = e.clientY - rect.top;
        selectionBox.style.display = 'block';
        selectionBox.classList.add('active');
    });

    // 마우스 이동 - 선택 영역 업데이트
    videoContainer.addEventListener('mousemove', (e) => {
        if (!isSelecting || !cameraStream) return;
        const rect = videoContainer.getBoundingClientRect();
        selectionEnd.x = e.clientX - rect.left;
        selectionEnd.y = e.clientY - rect.top;

        updateSelectionBox();
    });

    // 마우스 업 - 선택 종료
    document.addEventListener('mouseup', () => {
        if (isSelecting) {
            isSelecting = false;
        }
    });
}

// 선택 박스 업데이트
function updateSelectionBox() {
    if (!selectionBox) return;

    const left = Math.min(selectionStart.x, selectionEnd.x);
    const top = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
}

// 선택 영역 좌표를 비디오 좌표로 변환
function getSelectionRect() {
    if (!cameraVideo || !selectionBox) return null;

    // 최소화 상태 확인
    const isMinimized = cameraModal && cameraModal.classList.contains('minimized');
    if (isMinimized) {
        return null; // 최소화 상태에서는 null 반환하여 savedSelectionRect 사용
    }

    const videoRect = cameraVideo.getBoundingClientRect();
    const containerRect = selectionBox.parentElement.getBoundingClientRect();

    // display: none인 경우 width/height가 0이 될 수 있음
    if (videoRect.width === 0 || videoRect.height === 0) {
        return null;
    }

    const scaleX = cameraVideo.videoWidth / videoRect.width;
    const scaleY = cameraVideo.videoHeight / videoRect.height;

    // scale이 유효하지 않은 경우 (NaN, Infinity 등)
    if (!isFinite(scaleX) || !isFinite(scaleY)) {
        return null;
    }

    const left = Math.min(selectionStart.x, selectionEnd.x);
    const top = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    // 영역이 너무 작으면 전체 화면 사용
    if (width < 10 || height < 10) {
        return null;
    }

    return {
        x: left * scaleX,
        y: top * scaleY,
        width: width * scaleX,
        height: height * scaleY
    };
}

// 카메라 열기 함수
async function openCamera() {
    try {
        // 화면 공유 권한 확인
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            throw new Error('이 브라우저는 화면 공유 기능을 지원하지 않습니다.');
        }

        // 화면 공유 요청 (스크린 캡처)
        cameraStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: 'browser' // 브라우저 화면 캡처
            },
            audio: false
        });
        cameraVideo.srcObject = cameraStream;
        cameraModal.classList.add('show');
        cameraCaptureBtn.disabled = false;

        // 영역 선택 초기화
        setTimeout(() => {
            initSelectionArea();
        }, 100);

        // 스트림이 종료되면 모달 닫기
        cameraStream.getVideoTracks()[0].addEventListener('ended', () => {
            closeCamera();
        });
    } catch (error) {
        console.error('화면 공유 실패:', error);
        let errorMessage = '화면 공유에 접근할 수 없습니다.';

        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage = '화면 공유 권한이 거부되었습니다. 브라우저 설정에서 화면 공유 권한을 허용해주세요.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorMessage = '화면을 찾을 수 없습니다.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            errorMessage = '화면이 다른 애플리케이션에서 사용 중입니다.';
        }

        alert(errorMessage);
    }
}

// 카메라 최소화/최대화 토글 함수
function toggleMinimize() {
    if (!cameraModal) return;

    const isMinimized = cameraModal.classList.contains('minimized');
    if (isMinimized) {
        cameraModal.classList.remove('minimized');
    } else {
        cameraModal.classList.add('minimized');
    }
}

// 카메라 닫기 함수
function closeCamera() {
    // 자동 캡처 중지
    stopAutoCapture();

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraModal.classList.remove('show');
    cameraModal.classList.remove('minimized');
    cameraLoading.style.display = 'none';
    cameraCaptureBtn.disabled = false;
    cameraCaptureBtn.textContent = '캡처';

    // 중단없이 체크박스 리셋
    if (cameraContinueCheckbox) {
        cameraContinueCheckbox.checked = false;
    }

    // 선택 영역 리셋
    if (selectionBox) {
        selectionBox.style.display = 'none';
        selectionBox.classList.remove('active');
    }
    isSelecting = false;
    lastOCRText = '';
    savedSelectionRect = null;

    // 드래그 위치 리셋
    isDragging = false;
    cameraModal.classList.remove('dragging');
    cameraModal.style.left = '';
    cameraModal.style.top = '';
    cameraModal.style.right = '20px';
    cameraModal.style.bottom = '20px';
}


// 자동 캡처 시작
function startAutoCapture() {
    if (isAutoCaptureMode) return;

    isAutoCaptureMode = true;
    cameraCaptureBtn.textContent = '자동 캡처 중...';
    cameraCaptureBtn.disabled = true;

    // 2초마다 자동 캡처
    autoCaptureInterval = setInterval(() => {
        if (cameraStream && isAutoCaptureMode) {
            captureAndOCR(true);
        }
    }, 2000); // 2초 간격
}

// 자동 캡처 중지
function stopAutoCapture() {
    if (!isAutoCaptureMode) return;

    isAutoCaptureMode = false;
    if (autoCaptureInterval) {
        clearInterval(autoCaptureInterval);
        autoCaptureInterval = null;
    }
    cameraCaptureBtn.textContent = '캡처';
    cameraCaptureBtn.disabled = false;
}

// 이미지 캡처 및 OCR 처리 함수 (Feature Flag로 선택)
async function captureAndOCR(isAutoMode = false) {
    // Feature Flag 확인
    const useWorker = window.QPLAY_FEATURES?.enableOcrPool && window.ocrWorker;

    if (useWorker) {
        try {
            return await captureAndOCRWithWorker(isAutoMode);
        } catch (error) {
            console.warn('Worker OCR 실패, 기존 방식으로 fallback:', error);
            return await captureAndOCRLegacy(isAutoMode);
        }
    }

    return await captureAndOCRLegacy(isAutoMode);
}

// Workers를 사용한 OCR
async function captureAndOCRWithWorker(isAutoMode = false) {
    if (!cameraStream || !window.ocrWorker) {
        return await captureAndOCRLegacy(isAutoMode);
    }

    const requestId = `ocr-${Date.now()}-${Math.random()}`;
    const startTime = performance.now();

    try {
        if (!isAutoMode) {
            cameraCaptureBtn.disabled = true;
        }

        const selectionRect = getSelectionRect();
        const captureRect = isAutoMode && !selectionRect ? savedSelectionRect : selectionRect;

        if (!captureRect && !isAutoMode) {
            alert('영역을 선택해주세요.');
            cameraLoading.style.display = 'none';
            cameraCaptureBtn.disabled = false;
            return;
        }

        const canvas = document.createElement('canvas');

        if (captureRect) {
            canvas.width = captureRect.width;
            canvas.height = captureRect.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(
                cameraVideo,
                captureRect.x, captureRect.y, captureRect.width, captureRect.height,
                0, 0, captureRect.width, captureRect.height
            );
        } else {
            canvas.width = cameraVideo.videoWidth;
            canvas.height = cameraVideo.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
        }

        // 이미지 전처리 적용 (OCR 성능 향상)
        preprocessImageForOCR(canvas);

        const imageBitmap = await createImageBitmap(canvas);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('OCR 타임아웃'));
            }, 30000);

            const handler = (event) => {
                if (event.data.id !== requestId) {
                    return;
                }

                clearTimeout(timeout);
                window.ocrWorker.removeEventListener('message', handler);

                if (event.data.type === 'ocr-error') {
                    reject(new Error(event.data.error));
                    return;
                }

                if (event.data.type === 'ocr-result') {
                    const ocrMs = performance.now() - startTime;
                    if (window.logTelemetry) {
                        window.logTelemetry({
                            event: 'ocr-complete',
                            ocr_ms: ocrMs,
                            confidence: event.data.confidence
                        });
                    }

                    let cleanedText = event.data.text.trim().replace(/\s+/g, ' ').replace(/\n/g, ' ');

                    // 특수문자 제거 (한글, 영문, 숫자, 기본 구두점만 유지)
                    cleanedText = cleanedText.replace(/[^가-힣a-zA-Z0-9\s?.,!;:()[\]{}』」]/g, ' ');
                    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

                    // OCR 후처리: 한자 → 한글 변환
                    cleanedText = postProcessOCRText(cleanedText);

                    // 음독 문제 감지
                    const isPronunciationQuestion = cleanedText.includes('음독') ||
                        cleanedText.includes('읽기') ||
                        cleanedText.includes('독음') ||
                        cleanedText.includes('읽으');
                    // 선택지 추출을 위해 항상 originalText 전달
                    const originalText = cleanedText;

                    // 문제만 추출 (OCR 결과에서 문제 부분만 추출, 원본 텍스트 전달)
                    cleanedText = extractQuestion(cleanedText, originalText);

                    if (isAutoMode) {
                        if (cleanedText && cleanedText.length > 0 && cleanedText !== lastOCRText) {
                            lastOCRText = cleanedText;
                            processOCRResult(cleanedText, true);
                        }
                    } else {
                        if (cleanedText && cleanedText.length > 0) {
                            lastOCRText = cleanedText;
                            savedSelectionRect = captureRect;
                            processOCRResult(cleanedText, false);
                            startAutoCapture();
                        }
                    }

                    cameraLoading.style.display = 'none';
                    if (!isAutoMode) {
                        cameraCaptureBtn.disabled = false;
                    }

                    resolve();
                }
            };

            window.ocrWorker.addEventListener('message', handler);
            window.ocrWorker.postMessage({
                type: 'ocr',
                id: requestId,
                payload: imageBitmap,
                config: {
                    lang: 'eng+kor',
                    tesseditPagesegMode: 6
                }
            }, [imageBitmap]);
        });
    } catch (error) {
        console.error('Worker OCR 처리 실패:', error);
        return await captureAndOCRLegacy(isAutoMode);
    }
}

// 이미지 전처리 함수 (OCR 성능 향상)
function preprocessImageForOCR(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // 1. 그레이스케일 변환 + 대비 증가
    const contrastFactor = 1.3; // 대비 증가 계수 (1.0 = 원본)

    for (let i = 0; i < data.length; i += 4) {
        // 그레이스케일 변환 (RGB를 밝기값으로)
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

        // 대비 증가 적용
        let adjusted = ((gray - 128) * contrastFactor) + 128;
        adjusted = Math.max(0, Math.min(255, adjusted)); // 0-255 범위로 제한

        // RGB 모두 같은 값으로 설정 (그레이스케일)
        data[i] = adjusted;     // R
        data[i + 1] = adjusted; // G
        data[i + 2] = adjusted; // B
        // data[i + 3]은 알파값이므로 그대로 유지
    }

    ctx.putImageData(imageData, 0, 0);

    // 2. 크기 조정 (너무 크면 느리고, 너무 작으면 정확도 하락)
    const maxWidth = 1600; // 최대 너비
    if (canvas.width > maxWidth) {
        const scale = maxWidth / canvas.width;
        const newWidth = maxWidth;
        const newHeight = canvas.height * scale;

        // 임시 캔버스에 리사이징
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = newWidth;
        tempCanvas.height = newHeight;
        const tempCtx = tempCanvas.getContext('2d');

        // 고품질 리사이징
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';
        tempCtx.drawImage(canvas, 0, 0, newWidth, newHeight);

        // 원본 캔버스 크기 변경 및 복사
        canvas.width = newWidth;
        canvas.height = newHeight;
        ctx.drawImage(tempCanvas, 0, 0);
    }

    return canvas;
}

// 기존 OCR 함수 (레거시)
async function captureAndOCRLegacy(isAutoMode = false) {
    if (!cameraStream) return;

    try {
        if (!isAutoMode) {
            cameraCaptureBtn.disabled = true;
        }
        // OCR 처리 중 텍스트 숨김
        // cameraLoading.style.display = 'block';

        // 선택 영역 가져오기
        const selectionRect = getSelectionRect();

        // 자동 모드이고 선택 영역이 없으면 저장된 영역 사용
        const captureRect = isAutoMode && !selectionRect ? savedSelectionRect : selectionRect;

        if (!captureRect && !isAutoMode) {
            alert('영역을 선택해주세요.');
            cameraLoading.style.display = 'none';
            cameraCaptureBtn.disabled = false;
            return;
        }

        // 비디오 프레임을 캔버스에 캡처
        const canvas = document.createElement('canvas');

        if (captureRect) {
            // 선택 영역만 캡처
            canvas.width = captureRect.width;
            canvas.height = captureRect.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(
                cameraVideo,
                captureRect.x, captureRect.y, captureRect.width, captureRect.height,
                0, 0, captureRect.width, captureRect.height
            );
        } else {
            // 전체 화면 캡처 (영역 선택 안 함)
            canvas.width = cameraVideo.videoWidth;
            canvas.height = cameraVideo.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
        }

        // 이미지 전처리 적용 (OCR 성능 향상)
        preprocessImageForOCR(canvas);

        // 캔버스를 이미지로 변환
        const imageData = canvas.toDataURL('image/png');

        // Tesseract.js로 OCR 수행 (한국어 + 영어)
        const { data: { text } } = await Tesseract.recognize(imageData, 'kor+eng', {
            logger: m => {
                // OCR 처리 중 진행률 표시 숨김
                // if (m.status === 'recognizing text' && !isAutoMode) {
                //     cameraLoading.textContent = `OCR 처리 중... ${Math.round(m.progress * 100)}%`;
                // }
            },
            // OCR 정확도 향상을 위한 옵션
            tessedit_pageseg_mode: '6' // 단일 텍스트 블록으로 인식
        });

        // 텍스트 정리
        let cleanedText = text.trim().replace(/\s+/g, ' ').replace(/\n/g, ' ');

        // 특수문자 제거 (한글, 영문, 숫자, 기본 구두점만 유지)
        cleanedText = cleanedText.replace(/[^가-힣a-zA-Z0-9\s?.,!;:()[\]{}』」]/g, ' ');
        cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

        // OCR 후처리: 한자 → 한글 변환
        cleanedText = postProcessOCRText(cleanedText);

        // 음독 문제 감지
        const isPronunciationQuestion = cleanedText.includes('음독') ||
            cleanedText.includes('읽기') ||
            cleanedText.includes('독음') ||
            cleanedText.includes('읽으');
        // 선택지 추출을 위해 항상 originalText 전달
        const originalText = cleanedText;

        // 문제만 추출 (OCR 결과에서 문제 부분만 추출, 원본 텍스트 전달)
        cleanedText = extractQuestion(cleanedText, originalText);

        // 자동 모드일 때만 텍스트 변경 확인
        if (isAutoMode) {
            // 텍스트가 변경되었는지 확인 (추출된 문제 기준)
            if (cleanedText && cleanedText.length > 0 && cleanedText !== lastOCRText) {
                lastOCRText = cleanedText;
                // 자동 검색 수행 (검색창에 검색어 입력)
                processOCRResult(cleanedText, true);
            }
        } else {
            // 수동 모드: 첫 캡처 시 자동 모드 시작
            if (cleanedText && cleanedText.length > 0) {
                lastOCRText = cleanedText;
                savedSelectionRect = captureRect;
                processOCRResult(cleanedText, false);

                // 자동 캡처 모드 시작 (문제가 바뀔 때마다 자동 캡처)
                startAutoCapture();
            }
        }

        cameraLoading.style.display = 'none';

        if (!isAutoMode) {
            cameraCaptureBtn.disabled = false;
        }
    } catch (error) {
        console.error('OCR 처리 실패:', error);

        if (!isAutoMode) {
            let errorMessage = 'OCR 처리 중 오류가 발생했습니다.';

            if (error.message && error.message.includes('language')) {
                errorMessage = 'OCR 언어 데이터를 로드할 수 없습니다. 인터넷 연결을 확인해주세요.';
            } else if (error.message) {
                errorMessage = 'OCR 처리 실패: ' + error.message;
            }

            alert(errorMessage);
            cameraLoading.style.display = 'none';
            cameraLoading.textContent = 'OCR 처리 중...';
            cameraCaptureBtn.disabled = false;
        } else {
            cameraLoading.style.display = 'none';
        }
    }
}

// 문제만 추출하는 함수
// OCR 후처리: 한자 → 한글 변환 (일반적인 사자성어)
// 정규식 패턴 상수 (성능 최적화)
const HANJA_PATTERN = /[\u4E00-\u9FFF]{2,}/g;

function postProcessOCRText(text) {
    if (!text) return text;

    // 빠른 체크: 한자 문자가 있는지 먼저 확인 (성능 최적화)
    let hasHanja = false;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0x4E00 && code <= 0x9FFF) {
            hasHanja = true;
            break;
        }
    }

    // 한자가 없으면 즉시 반환 (성능 최적화)
    if (!hasHanja) return text;

    // 일반적인 사자성어 한자 → 한글 음독 매핑
    const hanjaToKorean = {
        '自業自得': '자업자득',
        '自業自破': '자업자파',
        '自業自困': '자업자곤',
        '自業自造': '자업자조',
        // 더 많은 매핑은 필요시 추가 가능
    };

    let processedText = text;

    // 한자 패턴 찾기 (유니코드 범위: \u4E00-\u9FFF)
    const hanjaMatches = text.match(HANJA_PATTERN);

    if (hanjaMatches) {
        hanjaMatches.forEach(hanja => {
            if (hanjaToKorean[hanja]) {
                // 한자를 한글 음독으로 교체
                processedText = processedText.replace(hanja, hanjaToKorean[hanja]);
            }
        });
    }

    return processedText;
}

function extractQuestion(text, originalText = null) {
    if (!text) return '';

    // 원본 텍스트가 없으면 현재 텍스트를 원본으로 사용
    const fullText = originalText || text;

    let cleaned = text.trim();

    // 1. 카테고리 정보 제거 (예: "클세사 : 규들레이")
    cleaned = cleaned.replace(/^[^:]*:\s*[^\[]*/g, '');

    // 2. 문제 번호 제거 - 다양한 패턴 처리
    // [문제 1], [문제1], [1], 문제』, 문제」, 문제:, 문제 등
    // "내 문제 10" 같은 패턴도 제거 (앞뒤 공백 처리)
    cleaned = cleaned.replace(/\[문제\s*\d+\]|\[\d+\]/g, '');
    cleaned = cleaned.replace(/\s*문제\s*\d+\s*/g, ' '); // "내 문제 10" 같은 패턴 제거
    cleaned = cleaned.replace(/문제[』」:：]\s*/g, ''); // 문제』, 문제」, 문제: 제거
    cleaned = cleaned.replace(/^문제\s+/g, ''); // 시작 부분의 "문제 " 제거

    // 음독 문제 감지
    const isPronunciationQuestion = cleaned.includes('음독') ||
        cleaned.includes('읽기') ||
        cleaned.includes('독음') ||
        cleaned.includes('읽으');

    // 3. 물음표를 기준으로 문제와 선택지/정답 분리 (가장 중요)
    const questionMarkIndex = cleaned.indexOf('?');
    let questionEndIndex = -1;
    let questionText = '';
    let choicesText = '';

    if (questionMarkIndex !== -1) {
        questionEndIndex = questionMarkIndex + 1;
        questionText = cleaned.substring(0, questionEndIndex);
        choicesText = cleaned.substring(questionEndIndex);
    } else {
        // 물음표가 없으면 "정답", "답", "해설" 등의 키워드로 분리
        const answerKeywords = ['정답', '답', '해설', '해답', '답안', '정답:', '답:', '해설:'];
        for (const keyword of answerKeywords) {
            const keywordIndex = cleaned.toLowerCase().indexOf(keyword.toLowerCase());
            if (keywordIndex !== -1) {
                questionEndIndex = keywordIndex;
                questionText = cleaned.substring(0, keywordIndex);
                choicesText = cleaned.substring(keywordIndex);
                break;
            }
        }
        if (questionEndIndex === -1) {
            questionText = cleaned;
        }
    }

    // 원본 텍스트에서 선택지 영역 추출 (선택지 키워드 추출용)
    const fullCleaned = fullText.trim().replace(/\s+/g, ' ').replace(/\n/g, ' ');
    const fullQuestionEndIndex = fullCleaned.indexOf('?') !== -1
        ? fullCleaned.indexOf('?') + 1
        : (fullCleaned.toLowerCase().indexOf('정답') !== -1
            ? fullCleaned.toLowerCase().indexOf('정답')
            : fullCleaned.length);
    const answerSection = fullCleaned.substring(fullQuestionEndIndex);

    // 음독 문제인 경우 선택지에서 한글 음독 추출 (개선 버전)
    if (isPronunciationQuestion && questionEndIndex !== -1) {
        // 1. 문제 텍스트에서 한자 제거 (한글만 남기기)
        const questionWithoutHanja = questionText.replace(/[\u4E00-\u9FFF]/g, '').trim();

        // 2. 선택지 영역에서 한자 제거 (한글 음독만 남기기)
        const answerSectionWithoutHanja = answerSection.replace(/[\u4E00-\u9FFF]/g, ' ').trim();

        // 3. 일반 문제와 동일한 선택지 패턴 매칭 사용 (더 정확함)
        const choicePatterns = [
            /\d+[\.\)]\s*([가-힣]{2,})/g,  // "1. 자업자득", "1) 자업자득"
            /[①②③④⑤⑥⑦⑧⑨⑩]\s*([가-힣]{2,})/g,  // "① 자업자득"
            /([가-힣]{3,8})(?=\s|$|,|\.|\))/g  // 연속된 한글 (사자성어)
        ];

        const pronunciations = new Set();

        // 선택지 패턴으로 추출
        choicePatterns.forEach(pattern => {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(answerSectionWithoutHanja)) !== null) {
                const pron = match[1]?.trim();
                if (pron && pron.length >= 2 && pron.length <= 8) {
                    pronunciations.add(pron);
                }
            }
        });

        // 한자 제거된 선택지 영역에서 직접 한글 추출 (백업)
        if (pronunciations.size === 0) {
            const directMatches = answerSectionWithoutHanja.match(/[가-힣]{3,8}/g);
            if (directMatches) {
                directMatches.forEach(m => {
                    if (m.length >= 3 && m.length <= 8) {
                        pronunciations.add(m);
                    }
                });
            }
        }

        // 문제 텍스트에서 이미 추출된 한글 음독도 추가
        const questionPronunciations = questionWithoutHanja.match(/[가-힣]{3,8}/g);
        if (questionPronunciations) {
            questionPronunciations.forEach(p => {
                if (p.length >= 3 && p.length <= 8) {
                    pronunciations.add(p);
                }
            });
        }

        // 최종 검색어 구성: 한자 제거된 문제 + 추출된 음독들
        const extractedPronunciations = Array.from(pronunciations).slice(0, 6);
        if (extractedPronunciations.length > 0) {
            questionText = questionWithoutHanja + ' ' + extractedPronunciations.join(' ');
        } else {
            // 음독을 못 찾았어도 한자 제거된 문제로라도 검색
            questionText = questionWithoutHanja;
        }
    } else if (!isPronunciationQuestion) {
        // 선택지에서 의미 있는 키워드 추출 (2글자 이상, 단일 문자 제외)
        // answerSection을 우선 사용 (원본 텍스트에서 직접 추출)
        const textToSearch = answerSection && answerSection.length > 0 ? answerSection : choicesText;

        if (textToSearch && textToSearch.length > 0) {
            // 선택지 패턴: "1. 내용", "2. 내용", "① 내용", "② 내용" 등
            const choicePatterns = [
                /\d+\.\s*([가-힣a-zA-Z0-9]{2,})/g,  // "1. 내용"
                /[①②③④⑤⑥⑦⑧⑨⑩]\s*([가-힣a-zA-Z0-9]{2,})/g  // "① 내용"
            ];

            const extractedChoices = [];
            choicePatterns.forEach(pattern => {
                // 정규식의 lastIndex 초기화
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(textToSearch)) !== null) {
                    const choiceContent = match[1]?.trim();
                    // 단일 문자(a, b, c, d) 제외, 2글자 이상만, 한글/영문/숫자 포함
                    if (choiceContent && choiceContent.length >= 2 && !/^[a-z]$/i.test(choiceContent)) {
                        extractedChoices.push(choiceContent);
                    }
                }
            });

            // 선택지 키워드를 문제 텍스트에 추가 (검색 정확도 향상)
            if (extractedChoices.length > 0) {
                // 중복 제거 후 추가 (구분자로 표시하여 나중에 가중치 적용)
                const uniqueChoices = [...new Set(extractedChoices)];
                questionText = questionText + ' |CHOICES| ' + uniqueChoices.join(' ');
            }
        }
    }

    cleaned = questionText;

    // 5. 정답 관련 키워드 제거 (물음표 이후에 남아있을 수 있는 경우)
    cleaned = cleaned.replace(/정답.*$/i, '');
    cleaned = cleaned.replace(/답.*$/i, '');
    cleaned = cleaned.replace(/해설.*$/i, '');

    // 6. 불필요한 공백 정리
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // 7. OCR 오류 개선 (일반적인 패턴)
    cleaned = cleaned.replace(/FIFAEEY/gi, 'FIFA');
    cleaned = cleaned.replace(/월드\s*$/g, '월드컵');

    // OCR 오류 패턴 교정 (띄어쓰기 오류 등)
    cleaned = cleaned.replace(/고\s*치약/g, '고치는 약');
    cleaned = cleaned.replace(/고치약/g, '고치는 약');
    cleaned = cleaned.replace(/\s*치약\s*없다/g, ' 약 없다');

    // 8. 문제가 너무 짧으면 원본 반환 (필터링이 너무 강했을 경우)
    if (cleaned.length < 5) {
        // 원본에서 최소한의 정리만 수행
        cleaned = text.trim().replace(/\s+/g, ' ');
        // 물음표 이후 제거
        const qIndex = cleaned.indexOf('?');
        if (qIndex !== -1) {
            cleaned = cleaned.substring(0, qIndex + 1);
        }
        // 문제』 같은 패턴 제거
        cleaned = cleaned.replace(/문제[』」:：]\s*/g, '');
        cleaned = cleaned.replace(/^문제\s+/g, '');
    }

    return cleaned;
}

// 핵심 키워드만 추출하는 함수
function extractKeywords(text) {
    if (!text) return [];

    // 1. 문제만 추출 (이미 extractQuestion으로 처리된 경우)
    let cleaned = text.trim();

    // 2. 물음표, 특수문자 제거 (단, 숫자는 유지)
    // 대괄호는 공백으로 변환하여 단어 분리 개선
    cleaned = cleaned.replace(/[?.,!;:(){}』」]/g, ' ');
    cleaned = cleaned.replace(/[\[\]]/g, ' '); // 대괄호는 공백으로

    // 3. 접속사 및 불필요한 단어 제거 (단어 단위로)
    const conjunctions = ['그리고', '또한', '또는', '하지만', '그러나', '그런데', '따라서', '그래서', '그러므로', '그러면', '만약', '만일', '만약에'];
    conjunctions.forEach(conj => {
        // 단어 단위로만 제거 (공백으로 구분된)
        const escaped = conj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'gi');
        cleaned = cleaned.replace(regex, ' ');
    });

    // 4. 조사 제거 제거 (테스트용 - 조사 제거 없이 검색)
    // 동사 어미 보호 리스트 (조사로 오인식 방지)
    // const verbEndings = ['고치는', '고치고', '고쳐서', '고쳐', '고친', '고칠', '고친다', '고친다면', '고치면', '고치니', '고치며', '고치면서'];
    // const particles = ['은', '는', '이', '가', '을', '를', '의', '에', '에서', '와', '과', '도', '만', '조차', '까지', '부터', '에게', '한테', '께', '로', '으로', '처럼', '같이', '만큼', '보다'];
    // 
    // particles.forEach(particle => {
    //     // 동사 어미 보호: 동사 어미 패턴이 포함된 경우 조사 제거 건너뛰기
    //     const isVerbEnding = verbEndings.some(ending => cleaned.includes(ending));
    //     if (isVerbEnding && particle === '는') {
    //         // "고치는" 같은 동사 어미는 보호
    //         return;
    //     }
    //     
    //     // 단어 끝에 붙은 조사만 제거 (최소 2글자 이상인 단어에서만)
    //     const escapedParticle = particle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    //     const regex = new RegExp(`([가-힣a-zA-Z0-9]{2,})${escapedParticle}(?=\\s|$)`, 'g');
    //     cleaned = cleaned.replace(regex, '$1');
    //     // 단독으로 있는 조사 제거
    //     const regex2 = new RegExp(`(^|\\s)${escapedParticle}(\\s|$)`, 'g');
    //     cleaned = cleaned.replace(regex2, ' ');
    // });

    // 5. 공백 정리
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // 6. 키워드 추출 (1글자 필터링 완화, 선택지 노이즈 제거)
    const keywords = cleaned.split(' ')
        .filter(word => {
            const trimmed = word.trim();
            // 빈 문자열 제거
            if (trimmed.length === 0) return false;

            // 단일 영문자 제거 (a, b, c, d 같은 선택지 번호)
            if (trimmed.length === 1 && /^[a-z]$/i.test(trimmed)) {
                return false;
            }

            // 1글자 단어 처리
            if (trimmed.length === 1) {
                // 숫자는 항상 포함
                if (/^\d$/.test(trimmed)) return true;
                // 한글 1글자도 포함 (의미 있는 단어일 수 있음)
                if (/^[가-힣]$/.test(trimmed)) return true;
                return false;
            }

            // 2글자 이상인 경우
            // 너무 짧은 영문 조합 제거 (aa, bb 같은 노이즈)
            if (trimmed.length === 2 && /^[a-z]{2}$/i.test(trimmed) && trimmed[0] === trimmed[1]) {
                return false;
            }

            return true;
        })
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length > 0);

    // 7. 중복 제거
    return [...new Set(keywords)];
}

// 키워드 추출 헬퍼 함수 (기존 extractKeywords 로직 재사용)
function extractKeywordsFromText(text) {
    if (!text) return [];

    let cleaned = text.trim();

    // 물음표, 특수문자 제거
    cleaned = cleaned.replace(/[?.,!;:(){}』」]/g, ' ');
    cleaned = cleaned.replace(/[\[\]]/g, ' ');

    // 접속사 및 불필요한 단어 제거
    const conjunctions = ['그리고', '또한', '또는', '하지만', '그러나', '그런데', '따라서', '그래서', '그러므로', '그러면', '만약', '만일', '만약에'];
    conjunctions.forEach(conj => {
        const escaped = conj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'gi');
        cleaned = cleaned.replace(regex, ' ');
    });

    // 조사 제거 제거 (테스트용 - 조사 제거 없이 검색)
    // const verbEndings = ['고치는', '고치고', '고쳐서', '고쳐', '고친', '고칠', '고친다', '고친다면', '고치면', '고치니', '고치며', '고치면서'];
    // const particles = ['은', '는', '이', '가', '을', '를', '의', '에', '에서', '와', '과', '도', '만', '조차', '까지', '부터', '에게', '한테', '께', '로', '으로', '처럼', '같이', '만큼', '보다'];
    // 
    // particles.forEach(particle => {
    //     const isVerbEnding = verbEndings.some(ending => cleaned.includes(ending));
    //     if (isVerbEnding && particle === '는') {
    //         return;
    //     }
    //     
    //     const escapedParticle = particle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    //     const regex = new RegExp(`([가-힣a-zA-Z0-9]{2,})${escapedParticle}(?=\\s|$)`, 'g');
    //     cleaned = cleaned.replace(regex, '$1');
    //     const regex2 = new RegExp(`(^|\\s)${escapedParticle}(\\s|$)`, 'g');
    //     cleaned = cleaned.replace(regex2, ' ');
    // });

    // 공백 정리
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // 키워드 추출
    const keywords = cleaned.split(' ')
        .filter(word => {
            const trimmed = word.trim();
            if (trimmed.length === 0) return false;

            if (trimmed.length === 1 && /^[a-z]$/i.test(trimmed)) {
                return false;
            }

            if (trimmed.length === 1) {
                if (/^\d$/.test(trimmed)) return true;
                if (/^[가-힣]$/.test(trimmed)) return true;
                return false;
            }

            if (trimmed.length === 2 && /^[a-z]{2}$/i.test(trimmed) && trimmed[0] === trimmed[1]) {
                return false;
            }

            return true;
        })
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length > 0);

    return [...new Set(keywords)];
}

// 문제와 선택지 키워드를 구분하여 추출하는 함수 (가중치 적용용)
function extractKeywordsWithWeights(text) {
    if (!text) return { questionKeywords: [], choiceKeywords: [] };

    // 선택지 구분자로 분리
    const parts = text.split('|CHOICES|');
    const questionPart = parts[0]?.trim() || text;
    const choicePart = parts[1]?.trim() || '';

    // 문제 키워드 추출
    const questionKeywords = extractKeywordsFromText(questionPart);

    // 선택지 키워드 추출
    const choiceKeywords = choicePart ? extractKeywordsFromText(choicePart) : [];

    return { questionKeywords, choiceKeywords };
}

const LONG_QUERY_THRESHOLD = 12;
const LONG_QUERY_SPLIT_REGEX = /(무엇이라할까요|무엇이라할까|무엇이라고할까요|무엇이라고|무엇이라|무엇인가요|무엇일까요|무엇일까|무엇인가|무엇인지|무엇입니까|무엇을|무엇이|무엇은|누구인가요|누구일까요|어디인가요|언제인가요|어떻게|왜인가요|어떤가요|어떤가|어떤가요|어떤가요|어떤가요)/gi;
const SEARCH_NOISE_PREFIX_PATTERNS = [
    /^출제자[가-힣0-9a-z]*/,
    /^정답[가-힣0-9a-z]*/,
    /^문제[가-힣0-9a-z]*/,
    /^카테고리[가-힣0-9a-z]*/,
    /^출처[가-힣0-9a-z]*/
];

function removeNoisePrefixes(token) {
    let cleaned = token;
    SEARCH_NOISE_PREFIX_PATTERNS.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });
    return cleaned;
}

function splitLongKeyword(keyword) {
    const tokens = [];
    const lowerKeyword = keyword.toLowerCase();
    LONG_QUERY_SPLIT_REGEX.lastIndex = 0;
    let lastIndex = 0;
    let match;

    while ((match = LONG_QUERY_SPLIT_REGEX.exec(lowerKeyword)) !== null) {
        const start = match.index;
        if (start > lastIndex) {
            const before = lowerKeyword.slice(lastIndex, start);
            if (before.length >= 2) {
                tokens.push(before);
            }
        }

        const matched = match[0];
        if (matched.length >= 2) {
            tokens.push(matched);
        }
        lastIndex = start + matched.length;
    }

    if (lastIndex < lowerKeyword.length) {
        const tail = lowerKeyword.slice(lastIndex);
        if (tail.length >= 2) {
            tokens.push(tail);
        }
    }

    if (tokens.length === 0) {
        const chunkSize = 3;
        for (let index = 0; index < lowerKeyword.length; index += chunkSize) {
            const chunk = lowerKeyword.slice(index, index + chunkSize);
            if (chunk.length >= 2) {
                tokens.push(chunk);
            }
        }
    }

    return [...new Set(tokens)];
}

function tokenizeSearchTerm(term) {
    const trimmed = term.trim();
    if (trimmed.length === 0) {
        return [];
    }

    const basicTokens = trimmed
        .split(/\s+/)
        .filter(word => word.length > 0)
        .map(word => word.toLowerCase());

    if (basicTokens.length > 1) {
        return [...new Set(basicTokens)];
    }

    const [singleToken] = basicTokens;
    if (!singleToken) {
        return [];
    }

    const noiseRemoved = removeNoisePrefixes(singleToken).replace(/[^가-힣0-9a-z]/g, '');
    const target = noiseRemoved.length > 0 ? noiseRemoved : singleToken;

    if (target.length < LONG_QUERY_THRESHOLD) {
        return [...new Set([target.toLowerCase()])];
    }

    const splitted = splitLongKeyword(target);
    return splitted.length > 0 ? splitted : [...new Set([target.toLowerCase()])];
}

function shouldForceFlexibleMatching(searchTerm, keywords) {
    const trimmed = searchTerm.trim();
    if (trimmed.length === 0) {
        return false;
    }
    const hasSpace = /\s/.test(trimmed);
    return !hasSpace && trimmed.length >= LONG_QUERY_THRESHOLD && keywords.length <= 1;
}

// 키워드 기반 검색 함수 (정확히 일치하는 문제만 검색)
function searchByKeywords(keywords, question, answer, isJokboMode = false) {
    if (keywords.length === 0) return false;

    const questionLower = question.toLowerCase();
    const answerLower = answer.toLowerCase();

    if (isJokboMode) {
        // 자동족보 모드: 키워드 중 일부만 포함되어도 검색 (OR 조건)
        // 또는 키워드의 일부만 매칭되어도 검색
        return keywords.some(keyword => {
            const keywordLower = keyword.toLowerCase();

            // 1. 정확한 단어 매칭
            const escapedKeyword = escapeRegex(keyword);
            const wordRegex = new RegExp(`(^|\\s)${escapedKeyword}(\\s|$)`, 'i');
            if (wordRegex.test(questionLower) || wordRegex.test(answerLower)) {
                return true;
            }

            // 2. 공백 제거 버전으로 확인
            const questionNoSpace = questionLower.replace(/\s+/g, '');
            const answerNoSpace = answerLower.replace(/\s+/g, '');
            const keywordNoSpace = keywordLower.replace(/\s+/g, '');
            if (questionNoSpace.includes(keywordNoSpace) || answerNoSpace.includes(keywordNoSpace)) {
                return true;
            }

            // 3. 부분 문자열 매칭 (키워드의 일부만 포함되어도 검색)
            // 키워드가 3글자 이상이면 2글자 이상 포함되어도 검색
            if (keyword.length >= 3) {
                const minLength = Math.max(2, Math.floor(keyword.length * 0.5)); // 최소 50% 이상
                for (let i = 0; i <= keyword.length - minLength; i++) {
                    const substring = keyword.substring(i, i + minLength);
                    if (questionLower.includes(substring) || answerLower.includes(substring)) {
                        return true;
                    }
                }
            }

            // 4. 키워드가 2글자 이상이면 직접 포함 여부 확인
            if (keyword.length >= 2) {
                if (questionLower.includes(keywordLower) || answerLower.includes(keywordLower)) {
                    return true;
                }
            }

            return false;
        });
    } else {
        // 기존 로직: 모든 키워드가 포함되어야 함 (AND 조건)
        return keywords.every(keyword => {
            // 키워드가 단어 단위로 포함되는지 확인 (정확한 단어 매칭)
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(^|\\s)${escapedKeyword}(\\s|$)`, 'i');
            const exactMatch = regex.test(questionLower) || regex.test(answerLower);

            // 정확한 단어 매칭이 실패했을 때, 공백 제거 버전으로도 확인
            // 예: '근로자가연' 입력 시 '근로자가 연간'에서 공백 제거 후 '근로자가연간'과 비교
            if (!exactMatch) {
                const questionNoSpace = questionLower.replace(/\s+/g, '');
                const answerNoSpace = answerLower.replace(/\s+/g, '');
                return questionNoSpace.includes(keyword) || answerNoSpace.includes(keyword);
            }

            return exactMatch;
        });
    }
}

// 일치도 점수 계산 함수 (자동족보 모드용)
function calculateMatchScore(keywords, question, answer) {
    if (keywords.length === 0) return 0;

    const questionLower = question.toLowerCase();
    const answerLower = answer.toLowerCase();
    let totalScore = 0;
    let matchedKeywords = 0;

    // 검색어 전체를 하나의 문자열로 합친 버전도 고려
    const fullSearchTerm = keywords.join(' ').toLowerCase();
    const questionNoSpace = questionLower.replace(/\s+/g, '');
    const answerNoSpace = answerLower.replace(/\s+/g, '');
    const fullSearchNoSpace = fullSearchTerm.replace(/\s+/g, '');

    // 전체 검색어가 포함되면 매우 높은 점수 (200점)
    if (questionLower.includes(fullSearchTerm) || answerLower.includes(fullSearchTerm)) {
        totalScore += 200;
    } else if (questionNoSpace.includes(fullSearchNoSpace) || answerNoSpace.includes(fullSearchNoSpace)) {
        totalScore += 150;
    }

    // 각 키워드별 점수 계산
    keywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        let keywordScore = 0;
        let matched = false;

        // 정확한 단어 매칭
        const escapedKeyword = escapeRegex(keyword);
        const wordRegex = new RegExp(`(^|\\s)${escapedKeyword}(\\s|$)`, 'i');
        const exactMatchInQuestion = wordRegex.test(questionLower);
        const exactMatchInAnswer = wordRegex.test(answerLower);

        if (exactMatchInQuestion || exactMatchInAnswer) {
            keywordScore = 100;
            matched = true;
            if (exactMatchInQuestion && exactMatchInAnswer) {
                keywordScore = 150;
            }
        } else {
            // 공백 제거 버전
            const keywordNoSpace = keywordLower.replace(/\s+/g, '');
            const noSpaceMatchInQuestion = questionNoSpace.includes(keywordNoSpace);
            const noSpaceMatchInAnswer = answerNoSpace.includes(keywordNoSpace);

            if (noSpaceMatchInQuestion || noSpaceMatchInAnswer) {
                keywordScore = 80;
                matched = true;
                if (noSpaceMatchInQuestion && noSpaceMatchInAnswer) {
                    keywordScore = 120;
                }
            } else if (keyword.length >= 2) {
                // 부분 매칭
                if (questionLower.includes(keywordLower) || answerLower.includes(keywordLower)) {
                    keywordScore = 30;
                    matched = true;
                }
            }
        }

        if (matched) {
            // 키워드 길이 가중치
            keywordScore *= (1 + keyword.length * 0.1);
            totalScore += keywordScore;
            matchedKeywords++;
        }
    });

    // 매칭된 키워드 수에 비례한 보너스 (곱하기 대신 더하기로 변경)
    // 매칭된 키워드가 많을수록 보너스 추가
    const matchRatio = matchedKeywords / keywords.length;
    totalScore += totalScore * (matchRatio * 0.3); // 매칭 비율에 따른 보너스 추가

    // 추가로 매칭된 키워드 수에 비례한 고정 보너스
    totalScore += matchedKeywords * 10;

    return totalScore;
}

// 일치도 점수 계산 함수 (문제/선택지 키워드 가중치 적용)
function calculateMatchScoreWithWeights(questionKeywords, choiceKeywords, question, answer) {
    const allQuestionKeywords = questionKeywords || [];
    const allChoiceKeywords = choiceKeywords || [];

    if (allQuestionKeywords.length === 0 && allChoiceKeywords.length === 0) return 0;

    const questionLower = question.toLowerCase();
    const answerLower = answer.toLowerCase();
    let totalScore = 0;
    let matchedQuestionKeywords = 0;
    let matchedChoiceKeywords = 0;

    // 문제 키워드 점수 계산 (높은 가중치)
    allQuestionKeywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        let keywordScore = 0;
        let matched = false;

        const escapedKeyword = escapeRegex(keyword);
        const wordRegex = new RegExp(`(^|\\s)${escapedKeyword}(\\s|$)`, 'i');
        const exactMatchInQuestion = wordRegex.test(questionLower);
        const exactMatchInAnswer = wordRegex.test(answerLower);

        if (exactMatchInQuestion || exactMatchInAnswer) {
            keywordScore = 100; // 문제 키워드 기본 점수
            matched = true;
            if (exactMatchInQuestion && exactMatchInAnswer) {
                keywordScore = 150;
            }
        } else {
            const keywordNoSpace = keywordLower.replace(/\s+/g, '');
            const questionNoSpace = questionLower.replace(/\s+/g, '');
            const answerNoSpace = answerLower.replace(/\s+/g, '');
            const noSpaceMatchInQuestion = questionNoSpace.includes(keywordNoSpace);
            const noSpaceMatchInAnswer = answerNoSpace.includes(keywordNoSpace);

            if (noSpaceMatchInQuestion || noSpaceMatchInAnswer) {
                keywordScore = 80;
                matched = true;
                if (noSpaceMatchInQuestion && noSpaceMatchInAnswer) {
                    keywordScore = 120;
                }
            } else if (keyword.length >= 2) {
                if (questionLower.includes(keywordLower) || answerLower.includes(keywordLower)) {
                    keywordScore = 30;
                    matched = true;
                }
            }
        }

        if (matched) {
            keywordScore *= (1 + keyword.length * 0.1);
            totalScore += keywordScore;
            matchedQuestionKeywords++;
        }
    });

    // 선택지 키워드 점수 계산 (낮은 가중치: 0.3배)
    allChoiceKeywords.forEach(keyword => {
        const keywordLower = keyword.toLowerCase();
        let keywordScore = 0;
        let matched = false;

        const escapedKeyword = escapeRegex(keyword);
        const wordRegex = new RegExp(`(^|\\s)${escapedKeyword}(\\s|$)`, 'i');
        const exactMatchInQuestion = wordRegex.test(questionLower);
        const exactMatchInAnswer = wordRegex.test(answerLower);

        if (exactMatchInQuestion || exactMatchInAnswer) {
            keywordScore = 30; // 선택지 키워드 기본 점수 (문제의 30%)
            matched = true;
            if (exactMatchInQuestion && exactMatchInAnswer) {
                keywordScore = 45;
            }
        } else {
            const keywordNoSpace = keywordLower.replace(/\s+/g, '');
            const questionNoSpace = questionLower.replace(/\s+/g, '');
            const answerNoSpace = answerLower.replace(/\s+/g, '');
            const noSpaceMatchInQuestion = questionNoSpace.includes(keywordNoSpace);
            const noSpaceMatchInAnswer = answerNoSpace.includes(keywordNoSpace);

            if (noSpaceMatchInQuestion || noSpaceMatchInAnswer) {
                keywordScore = 24;
                matched = true;
                if (noSpaceMatchInQuestion && noSpaceMatchInAnswer) {
                    keywordScore = 36;
                }
            } else if (keyword.length >= 2) {
                if (questionLower.includes(keywordLower) || answerLower.includes(keywordLower)) {
                    keywordScore = 9; // 선택지 부분 매칭 (문제의 30%)
                    matched = true;
                }
            }
        }

        if (matched) {
            keywordScore *= (1 + keyword.length * 0.1);
            totalScore += keywordScore;
            matchedChoiceKeywords++;
        }
    });

    // 매칭 비율 보너스 (문제 키워드에 더 높은 가중치)
    const questionMatchRatio = allQuestionKeywords.length > 0 ? matchedQuestionKeywords / allQuestionKeywords.length : 0;
    const choiceMatchRatio = allChoiceKeywords.length > 0 ? matchedChoiceKeywords / allChoiceKeywords.length : 0;

    // 문제 키워드 매칭 비율이 높을수록 보너스
    totalScore += totalScore * (questionMatchRatio * 0.3);
    totalScore += matchedQuestionKeywords * 10;
    totalScore += matchedChoiceKeywords * 3; // 선택지 키워드는 낮은 보너스

    return totalScore;
}

// OCR 결과를 검색창에 입력하고 검색 실행
function processOCRResult(text, isAutoMode = false) {
    // 텍스트 정리 (이미 extractQuestion으로 처리된 경우도 있음)
    let cleanedText = text.trim().replace(/\s+/g, ' ').replace(/\n/g, ' ');

    // 이미 |CHOICES| 구분자가 있으면 이미 처리된 텍스트
    const isAlreadyProcessed = cleanedText.includes('|CHOICES|');

    // 문제만 추출 (아직 처리되지 않은 경우)
    if (!isAlreadyProcessed && (!cleanedText.includes('?') || cleanedText.includes('문제') || cleanedText.includes('['))) {
        // 원본 텍스트를 originalText로 전달하여 선택지 추출 가능하도록 함
        cleanedText = extractQuestion(cleanedText, text);
    }

    if (cleanedText && cleanedText.length > 0) {
        // 키워드 추출 (가중치 적용 버전 사용)
        const { questionKeywords, choiceKeywords } = extractKeywordsWithWeights(cleanedText);

        // 검색창에는 문제 키워드만 표시
        const allKeywords = [...questionKeywords, ...choiceKeywords];
        const searchKeywords = questionKeywords.length > 0 ? questionKeywords : allKeywords;

        // 키워드 추출 실패 시 대체 로직 (기존 방식)
        if (searchKeywords.length === 0) {
            const fallbackText = cleanedText.replace(/[?.,!;:()[\]{}』」]/g, ' ').trim();
            const fallbackKeywords = fallbackText.split(' ')
                .filter(word => word.length >= 2)
                .map(word => word.toLowerCase())
                .filter(word => word.length > 0);
            questionKeywords.push(...fallbackKeywords);
        }

        // 디버깅 로그 (개발 환경에서만)
        if (!isAutoMode) {
            console.log('OCR 결과:', text);
            console.log('추출된 문제:', cleanedText);
            console.log('문제 키워드:', questionKeywords);
            console.log('선택지 키워드:', choiceKeywords);
        }

        // 검색창에는 문제 키워드만 표시
        const searchTerm = questionKeywords.length > 0 ? questionKeywords.join(' ') : allKeywords.join(' ');
        if (searchInput) {
            searchInput.value = searchTerm;
        }
        currentSearchTerm = searchTerm;
        displayedCount = 0;

        if (clearSearchBtn) {
            clearSearchBtn.classList.add('show');
        }

        // 키워드 정보를 전역 변수에 저장 (performSearch에서 사용)
        window.currentQuestionKeywords = questionKeywords;
        window.currentChoiceKeywords = choiceKeywords;

        // 검색 실행
        performSearch();

        // 검색 결과 확인 (검색 결과가 나왔으면 자동 캡처 중지 - 단, 중단없이 체크박스가 체크되어 있으면 중지하지 않음)
        setTimeout(() => {
            if (allFilteredResults.length > 0 && isAutoCaptureMode) {
                // 중단없이 체크박스가 체크되어 있으면 자동 캡처 계속
                const shouldContinue = cameraContinueCheckbox && cameraContinueCheckbox.checked;
                if (!shouldContinue) {
                    stopAutoCapture();
                    if (!isAutoMode) {
                        showNotification('검색 결과를 찾았습니다. 자동 캡처가 중지되었습니다.');
                    }
                }
            }
        }, 100);

        // 알림 표시
        if (!isAutoMode) {
            showNotification('문제를 인식했습니다');
        } else {
            showNotification('문제가 업데이트되었습니다');
        }
    } else {
        if (!isAutoMode) {
            alert('텍스트를 인식할 수 없습니다. 다시 시도해주세요.');
            cameraLoading.style.display = 'none';
            cameraLoading.textContent = 'OCR 처리 중...';
            cameraCaptureBtn.disabled = false;
        }
    }
}


// 검색 관련 변수 선언 (전역)
let searchInput = null;
let clearSearchBtn = null;

// 검색 기능 초기화
function initSearch() {
    searchInput = document.getElementById('searchInput');
    clearSearchBtn = document.getElementById('clearSearchBtn');

    if (!searchInput || !clearSearchBtn) {
        console.error('검색 요소를 찾을 수 없습니다.');
        // 재시도
        setTimeout(initSearch, 100);
        return;
    }

    // 검색 기능 (디바운싱 적용)
    searchInput.addEventListener('input', function (e) {
        const value = e.target.value.trim();
        currentSearchTerm = value;

        // 지우기 버튼 표시/숨김
        if (currentSearchTerm) {
            clearSearchBtn.classList.add('show');
        } else {
            clearSearchBtn.classList.remove('show');
        }

        // 이전 검색 요청 취소 (searchWorker 사용 시)
        if (currentSearchRequestId && searchWorker) {
            searchWorker.postMessage({
                type: 'cancel',
                id: currentSearchRequestId
            });
            currentSearchRequestId = null;
        }

        // 디바운싱: 300ms 지연
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            displayedCount = 0; // 검색어 변경 시 리셋
            performSearch();
        }, 300);
    });

    // 지우기 버튼 클릭 이벤트
    clearSearchBtn.addEventListener('click', function () {
        clearSearchInput();
    });
}

// 검색어 지우기 함수
function clearSearchInput() {
    if (!searchInput || !clearSearchBtn) return;
    searchInput.value = '';
    currentSearchTerm = '';
    clearSearchBtn.classList.remove('show');
    displayedCount = 0;
    performSearch();
    searchInput.focus();
}

// 페이지 로드 시 모든 기능 초기화
function initAll() {
    initEventListeners();
    initSearch();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
} else {
    initAll();
}

function performSearch(resetDisplay = false) {
    const resultsDiv = document.getElementById('results');

    if (!currentSearchTerm) {
        const totalCount = selectedSheet
            ? questionsData.filter(item => item.sheet === selectedSheet).length
            : questionsData.length;

        resultsDiv.innerHTML =
            `<div class="results-count">총 ${totalCount}개의 문제가 로드되었습니다. ${selectedSheet ? `(카테고리: ${selectedSheet})` : ''} 검색어를 입력하여 검색해보세요.</div>`;
        allFilteredResults = [];
        displayedCount = 0;
        return;
    }

    if (questionsData.length === 0) {
        resultsDiv.innerHTML = '<div class="no-results">데이터가 로드되지 않았습니다.</div>';
        allFilteredResults = [];
        displayedCount = 0;
        return;
    }

    // 검색 수행 (선택된 카테고리만) - 검색어가 변경되었거나 리셋 요청 시에만 재검색
    // 사용자가 직접 입력한 검색어는 조사 제거 없이 그대로 사용
    // 공백으로 구분된 단어들을 키워드로 사용
    const keywords = tokenizeSearchTerm(currentSearchTerm);
    const forceFlexibleMatching = shouldForceFlexibleMatching(currentSearchTerm, keywords);

    if (resetDisplay || displayedCount === 0) {
        let filtered = questionsData.filter(item => {
            // 선택된 시트인지 확인
            if (selectedSheet && item.sheet !== selectedSheet) {
                return false;
            }

            // 검색어가 없으면 검색하지 않음
            if (!currentSearchTerm || currentSearchTerm.trim().length === 0) {
                return false;
            }

            // 키워드 기반 검색 (키워드가 1개 이상일 때 사용)
            if (keywords.length >= 1) {
                return searchByKeywords(
                    keywords,
                    item.question,
                    item.answer,
                    autoJokboEnabled || forceFlexibleMatching
                );
            }

            // 키워드가 없으면 검색하지 않음
            return false;
        });

        // 자동족보 모드일 때 일치도 점수로 정렬
        if (autoJokboEnabled && keywords.length > 0) {
            // 가중치 적용 버전 사용 (선택지 키워드가 있는 경우)
            // 전역 변수가 있고 유효한지 확인
            const useWeightedScore = window.currentQuestionKeywords &&
                Array.isArray(window.currentQuestionKeywords) &&
                window.currentChoiceKeywords &&
                Array.isArray(window.currentChoiceKeywords) &&
                window.currentChoiceKeywords.length > 0;

            filtered = filtered.map(item => {
                const matchScore = useWeightedScore
                    ? calculateMatchScoreWithWeights(
                        window.currentQuestionKeywords,
                        window.currentChoiceKeywords,
                        item.question,
                        item.answer
                    )
                    : calculateMatchScore(keywords, item.question, item.answer);

                return {
                    ...item,
                    matchScore
                };
            }).sort((a, b) => {
                // 일치도 점수가 높은 순으로 정렬
                return b.matchScore - a.matchScore;
            });

            // Margin 필터링: 낮은 확신도 결과 제거
            // 첫 번째와 두 번째 결과의 점수 차이가 너무 작으면 낮은 확신도 결과 제거
            if (filtered.length > 1) {
                const topScore = filtered[0]?.matchScore ?? 0;
                const secondScore = filtered[1]?.matchScore ?? 0;
                const margin = topScore - secondScore;
                const marginThreshold = topScore * 0.1; // 상위 점수의 10% 이상 차이

                // Margin이 너무 작고, 상위 결과의 점수가 낮으면 낮은 확신도 결과 제거
                if (margin < marginThreshold && topScore < 50) {
                    // 상위 결과만 유지 (점수가 비슷한 결과 제거)
                    const minScore = topScore * 0.7; // 상위 점수의 70% 이상
                    filtered = filtered.filter(item => (item.matchScore ?? 0) >= minScore);
                }
            }
        }

        allFilteredResults = filtered;
        displayedCount = 0;
    }

    if (allFilteredResults.length === 0) {
        resultsDiv.innerHTML = '<div class="no-results">검색 결과가 없습니다.</div>';
        return;
    }

    // 검색 결과가 있을 때 자동 캡처 중지 (단, 중단없이 체크박스가 체크되어 있으면 중지하지 않음)
    if (allFilteredResults.length > 0 && isAutoCaptureMode && displayedCount === 0) {
        // 중단없이 체크박스가 체크되어 있으면 자동 캡처 계속
        const shouldContinue = cameraContinueCheckbox && cameraContinueCheckbox.checked;
        if (!shouldContinue) {
            stopAutoCapture();
            showNotification('검색 결과를 찾았습니다. 자동 캡처가 중지되었습니다.');
        }
    }

    // 표시할 개수 계산
    const startIndex = displayedCount;
    const toDisplay = Math.min(maxResults, allFilteredResults.length - displayedCount);
    const itemsToRender = allFilteredResults.slice(startIndex, startIndex + toDisplay);
    const isFirstLoad = startIndex === 0;

    // 결과 표시
    let html = '';

    // 처음 로드하는 경우에만 카운트 표시
    if (isFirstLoad) {
        html = `<div class="results-count">검색 결과: ${allFilteredResults.length}개`;
        if (selectedSheet) {
            html += ` (카테고리: ${selectedSheet})`;
        }
        html += `</div>`;
    }

    itemsToRender.forEach(item => {
        // 문제 텍스트에서 "[문제]" 제거
        let questionText = item.question.replace(/\[문제\s*\d+\]|\[문제\]|\[\d+\]/g, '').trim();

        // 올라올라(꼬로록) 카테고리: 물음표 뒤의 텍스트를 답변에 합치기
        let fullAnswer = item.answer;
        if (item.sheet === '올라올라(꼬로록)') {
            const questionMarkIndex = questionText.indexOf('?');
            if (questionMarkIndex !== -1) {
                // 물음표 뒤의 텍스트 추출
                const afterQuestion = questionText.substring(questionMarkIndex + 1).trim();
                if (afterQuestion.length > 0) {
                    // 물음표까지만 문제로 표시
                    questionText = questionText.substring(0, questionMarkIndex + 1).trim();
                    // 전체 답 = 물음표 뒤 텍스트 + 저장된 답
                    fullAnswer = afterQuestion + item.answer;
                }
            }
        }

        // 키워드 기반 하이라이트 (각 키워드를 개별적으로 하이라이트)
        const highlightedQuestion = highlightTextWithKeywords(questionText, keywords.length > 0 ? keywords : [currentSearchTerm]);
        const highlightedAnswer = highlightTextWithKeywords(fullAnswer, keywords.length > 0 ? keywords : [currentSearchTerm]);
        const answerEscaped = escapeHtml(fullAnswer);

        html += `
                    <div class="result-item" data-answer="${answerEscaped.replace(/"/g, '&quot;')}">
                        <div class="result-sheet">
                            <span class="sheet-tag">${escapeHtml(item.sheet || '알 수 없음')}</span>
                        </div>
                        <div class="result-question">${highlightedQuestion}</div>
                        <div class="result-answer">${highlightedAnswer}</div>
                    </div>
                `;
    });

    displayedCount += toDisplay;

    // 더 보기 버튼 추가
    if (displayedCount < allFilteredResults.length) {
        html += `<button class="load-more-btn" onclick="loadMoreResults()">더 보기 (${allFilteredResults.length - displayedCount}개 남음)</button>`;
    }

    // 기존 결과에 추가하거나 새로 렌더링
    if (isFirstLoad) {
        resultsDiv.innerHTML = html;
    } else {
        // 더 보기 버튼 제거 후 추가
        const loadMoreBtn = resultsDiv.querySelector('.load-more-btn');
        if (loadMoreBtn) {
            loadMoreBtn.remove();
        }
        resultsDiv.insertAdjacentHTML('beforeend', html);
    }

    // 자동복사 기능 (성능 최적화: 비동기 처리) - 첫 번째 결과만 복사
    if (autoCopyEnabled && selectedSheet === "꽁꽁" && allFilteredResults.length > 0 && isFirstLoad) {
        const firstAnswer = allFilteredResults[0].answer;
        // 렌더링 블로킹 방지를 위해 비동기 처리
        setTimeout(() => {
            copyToClipboard(firstAnswer).catch(() => {
                // 복사 실패 시 조용히 처리 (사용자 경험 방해 최소화)
            });
        }, 0);
    }
}

// 더 보기 버튼 함수
function loadMoreResults() {
    performSearch(false);
}

// 텍스트 하이라이트 (단일 검색어)
function highlightText(text, searchTerm) {
    if (!searchTerm) return escapeHtml(text);

    const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
    return escapeHtml(text).replace(regex, '<span class="highlight">$1</span>');
}

// 키워드 기반 텍스트 하이라이트 (여러 키워드를 개별적으로 하이라이트)
function highlightTextWithKeywords(text, keywords) {
    if (!text || !keywords || keywords.length === 0) return escapeHtml(text);

    let highlightedText = escapeHtml(text);
    const textLower = text.toLowerCase();

    // 각 키워드를 하이라이트 (긴 키워드부터 처리하여 중첩 방지)
    const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);

    sortedKeywords.forEach(keyword => {
        if (!keyword || keyword.trim().length === 0) return;

        const keywordLower = keyword.toLowerCase();
        const escapedKeyword = escapeRegex(keyword);

        // 1. 정확한 단어 단위 매칭 시도 (공백으로 구분된 단어)
        const wordRegex = new RegExp(`(^|\\s)(${escapedKeyword})(\\s|$)`, 'gi');
        const hasWordMatch = wordRegex.test(textLower);

        if (hasWordMatch) {
            // 단어 단위로 하이라이트
            highlightedText = highlightedText.replace(wordRegex, (match, before, keywordMatch, after) => {
                // 이미 하이라이트된 부분은 건너뛰기
                if (before.includes('<span') || keywordMatch.includes('<span')) {
                    return match;
                }
                return `${before}<span class="highlight">${keywordMatch}</span>${after}`;
            });
        } else {
            // 2. 단어 단위 매칭이 없으면 공백 제거 버전으로 확인
            const textNoSpace = textLower.replace(/\s+/g, '');
            const keywordNoSpace = keywordLower.replace(/\s+/g, '');

            if (textNoSpace.includes(keywordNoSpace)) {
                // 원본 텍스트에서 키워드가 포함된 부분 찾기 (공백 무시)
                // 간단하게 키워드 자체를 하이라이트 (공백 포함 가능)
                const simpleRegex = new RegExp(`(${escapedKeyword})`, 'gi');
                if (!highlightedText.toLowerCase().includes(`<span class="highlight">${keywordLower}</span>`)) {
                    highlightedText = highlightedText.replace(simpleRegex, '<span class="highlight">$1</span>');
                }
            }
        }
    });

    return highlightedText;
}

// HTML 이스케이프
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 정규식 이스케이프
function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 카테고리 필터 UI 생성
function createCategoryFilters() {
    const categorySelect = document.getElementById('categorySelect');
    const categorySection = document.getElementById('categorySection');
    const reportCategory = document.getElementById('reportCategory'); // 제보 모달 카테고리

    categorySelect.innerHTML = '';
    if (reportCategory) {
        reportCategory.innerHTML = '<option value="">카테고리를 선택하세요</option>';
    }

    // 기본 선택값이 없으면 첫 번째 시트 선택
    if (!selectedSheet && allSheetNames.length > 0) {
        selectedSheet = allSheetNames[0];
    }

    // 옵션 추가
    allSheetNames.forEach(sheetName => {
        // 메인 카테고리 필터 옵션
        const option = document.createElement('option');
        option.value = sheetName;
        option.textContent = sheetName;
        if (selectedSheet === sheetName) {
            option.selected = true;
        }
        categorySelect.appendChild(option);

        // 제보 모달 카테고리 옵션 추가
        if (reportCategory) {
            const reportOption = document.createElement('option');
            reportOption.value = sheetName;
            reportOption.textContent = sheetName;
            reportCategory.appendChild(reportOption);
        }
    });

    // 드롭다운 활성화
    categorySelect.disabled = false;
    categorySection.classList.add('active');

    // 변경 이벤트 리스너
    categorySelect.onchange = function (e) {
        selectCategory(e.target.value);
    };
}

// 카테고리 선택 (단일 선택, 지연 로딩 적용)
async function selectCategory(sheetName) {
    selectedSheet = sheetName;
    displayedCount = 0; // 리셋

    // 카테고리 변경 시 데이터 로드 (콜백 함수 호출)
    if (window.onCategoryChange) {
        await window.onCategoryChange(sheetName);
    } else {
        // 콜백 없으면 직접 검색 수행
        performSearch(true);
    }
}

// 사용방법 모달 기능
const helpModalOverlay = document.getElementById('helpModalOverlay');
const helpModal = document.getElementById('helpModal');
const helpBtn = document.getElementById('helpBtn');
const helpModalClose = document.getElementById('helpModalClose');

// 사용방법 모달 열기
function openHelpModal() {
    if (helpModal && helpModalOverlay) {
        helpModalOverlay.classList.add('show');
        helpModal.classList.add('show');
    }
}

// 사용방법 모달 닫기
function closeHelpModal() {
    if (helpModal && helpModalOverlay) {
        helpModal.classList.remove('show');
        helpModalOverlay.classList.remove('show');
    }
}

// 이벤트 리스너
if (helpBtn) {
    helpBtn.addEventListener('click', openHelpModal);
}

if (helpModalClose) {
    helpModalClose.addEventListener('click', closeHelpModal);
}

// 배경 클릭 시 닫기
if (helpModalOverlay) {
    helpModalOverlay.addEventListener('click', closeHelpModal);
}

// ============================================
// 문제 제보 모달 기능
// ============================================
const reportModalOverlay = document.getElementById('reportModalOverlay');
const reportModal = document.getElementById('reportModal');
const reportBtn = document.getElementById('reportBtn');
const reportModalClose = document.getElementById('reportModalClose');
const reportForm = document.getElementById('reportForm');
const reportBtnCancel = document.getElementById('reportBtnCancel');
const imageInput = document.getElementById('imageInput');
const imageDropZone = document.getElementById('imageDropZone');
const imagePreview = document.getElementById('imagePreview');
const successMessage = document.getElementById('reportSuccessMessage');

// 문제 제보 모달 열기
function openReportModal() {
    if (reportModal && reportModalOverlay) {
        reportModalOverlay.classList.add('show');
        reportModal.classList.add('show');
        successMessage.classList.remove('show');
        reportForm.style.display = 'flex';
    }
}

// 문제 제보 모달 닫기
function closeReportModal() {
    if (reportModal && reportModalOverlay) {
        reportModal.classList.remove('show');
        reportModalOverlay.classList.remove('show');
    }
}

// 제보 폼 초기화
function resetReportForm() {
    reportForm.reset();
    imagePreview.innerHTML = '';
    imageDropZone.classList.remove('has-image');
    successMessage.classList.remove('show');
    reportForm.style.display = 'flex';
}

// 카테고리 드롭다운 설정
function setupReportCategoryDropdown() {
    const categorySelect = document.getElementById('reportCategory');
    if (!categorySelect) return;

    // 카테고리 이름 매핑
    const categoryNameMap = {
        'garoseseo': '가로세로',
        'kkong': '꽁꽁',
        'ollaolla': '올라올라',
        'ox_xo': '오엑'
    };

    // 기존 allSheetNames 사용 (페이지 로드 후 설정됨)
    if (typeof allSheetNames !== 'undefined' && allSheetNames.length > 0) {
        allSheetNames.forEach(categoryName => {
            const option = document.createElement('option');
            option.value = categoryName;
            option.textContent = categoryNameMap[categoryName] || categoryName;
            categorySelect.appendChild(option);
        });
    } else {
        // 기본 카테고리 설정 (데이터 로드 안 됨)
        const defaultCategories = ['garoseseo', 'kkong', 'ollaolla', 'ox_xo'];
        defaultCategories.forEach(categoryName => {
            const option = document.createElement('option');
            option.value = categoryName;
            option.textContent = categoryNameMap[categoryName] || categoryName;
            categorySelect.appendChild(option);
        });
    }
}

// 페이지 로드 후 카테고리 설정
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupReportCategoryDropdown);
} else {
    setupReportCategoryDropdown();
}

// 이미지 표시
function displayImage(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        imagePreview.innerHTML = `
                    <img src="${e.target.result}" class="report-image-preview" alt="Preview">
                    <button type="button" class="report-image-remove" id="removeImageBtn">이미지 제거</button>
                `;
        imageDropZone.classList.add('has-image');

        // 이미지 제거 버튼 이벤트
        document.getElementById('removeImageBtn').addEventListener('click', function (e) {
            e.preventDefault();
            imageInput.value = '';
            imagePreview.innerHTML = '';
            imageDropZone.classList.remove('has-image');
        });
    };
    reader.readAsDataURL(file);
}

// 이벤트 리스너
if (reportBtn) {
    reportBtn.addEventListener('click', openReportModal);
}

if (reportModalClose) {
    reportModalClose.addEventListener('click', closeReportModal);
}

if (reportBtnCancel) {
    reportBtnCancel.addEventListener('click', function (e) {
        e.preventDefault();
        closeReportModal();
    });
}

// 배경 클릭 시 닫기
if (reportModalOverlay) {
    reportModalOverlay.addEventListener('click', closeReportModal);
}

// 파일 입력 이벤트
if (imageInput) {
    imageInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) {
            displayImage(e.target.files[0]);
        }
    });
}

// 드래그 & 드롭
if (imageDropZone) {
    imageDropZone.addEventListener('click', function () {
        imageInput.click();
    });

    imageDropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        imageDropZone.style.borderColor = '#e74c3c';
        imageDropZone.style.background = '#ffe8e5';
    });

    imageDropZone.addEventListener('dragleave', function (e) {
        e.preventDefault();
        imageDropZone.style.borderColor = '#ddd';
        imageDropZone.style.background = '#fafafa';
    });

    imageDropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        imageDropZone.style.borderColor = '#ddd';
        imageDropZone.style.background = '#fafafa';

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                imageInput.files = e.dataTransfer.files;
                displayImage(file);
            } else {
                alert('이미지 파일만 업로드할 수 있습니다.');
            }
        }
    });
}

// 클립보드에서 이미지 붙여넣기
if (reportForm) {
    reportForm.addEventListener('paste', function (e) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                displayImage(file);
                // 파일 input에 할당 (FileList처럼 동작하도록)
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                imageInput.files = dataTransfer.files;
                break;
            }
        }
    });
}

// 폼 제출
if (reportForm) {
    reportForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const category = document.getElementById('reportCategory').value;
        const description = document.getElementById('reportDescription').value;
        const imageFile = imageInput.files[0];

        // 제출 버튼 비활성화
        const submitBtn = document.getElementById('reportBtnSubmit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = '전송 중...';

        try {
            let imageUrl = null;

            // 이미지가 있으면 먼저 업로드
            if (imageFile) {
                // base64로 변환
                const reader = new FileReader();
                imageUrl = await new Promise((resolve, reject) => {
                    reader.onload = (e) => {
                        resolve(e.target.result);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(imageFile);
                });
            }

            // Discord 웹훅 URL
            const DISCORD_WEBHOOK = 'https://discordapp.com/api/webhooks/1456287573365227582/tcHV62OGRYho5kNYZ1TLMdR4RwxM3He0TtnVOGH0k-cO-bKfUylnrZonGeOpKOi67zBW';

            // Discord 메시지 포맷 (Embed)
            const discordMessage = {
                content: '📋 새로운 문제가 제보되었습니다!',
                embeds: [
                    {
                        title: '🐛 문제 제보',
                        description: description,
                        color: 16711680, // 빨간색
                        fields: [
                            {
                                name: '� 카테고리',
                                value: category,
                                inline: true
                            },
                            {
                                name: '�📅 시간',
                                value: new Date().toLocaleString('ko-KR'),
                                inline: true
                            },
                            {
                                name: '🖼️ 이미지',
                                value: imageFile ? '✅ 첨부됨' : '❌ 없음',
                                inline: true
                            }
                        ],
                        thumbnail: imageUrl ? { url: imageUrl } : undefined,
                        footer: {
                            text: '그깽 족보 제보 시스템'
                        }
                    }
                ]
            };

            // Discord로 전송
            const response = await fetch(DISCORD_WEBHOOK, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(discordMessage)
            });

            // Discord webhook은 성공 시 204 No Content를 반환할 수 있음
            if (!response.ok && response.status !== 204) {
                throw new Error('Discord 전송 실패: ' + response.status);
            }

            // 로컬스토리지에도 저장 (백업)
            const reportData = {
                category: category,
                description: description,
                hasImage: !!imageFile,
                timestamp: new Date().toISOString()
            };
            console.log('제보 데이터:', reportData);

            let reports = JSON.parse(localStorage.getItem('qplayReports') || '[]');
            reports.push(reportData);
            localStorage.setItem('qplayReports', JSON.stringify(reports));

            // 성공 메시지 표시
            reportForm.style.display = 'none';
            successMessage.classList.add('show');

            // 2초 후 모달 닫기
            setTimeout(() => {
                closeReportModal();
                resetReportForm();
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }, 2000);

        } catch (error) {
            console.error('제보 전송 실패:', error);
            alert('제보 전송에 실패했습니다. 다시 시도해주세요.');
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

