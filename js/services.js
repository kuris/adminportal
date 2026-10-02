/* ============================================================
   서비스 메타데이터 (services.js)

   tracked: true  → public.page_views 에 service 값으로 기록되는 서비스 (통합 집계 대상)
   tracked: false → 아직 통합 로그 테이블에 기록하지 않는 서비스
                    · hanja(playhanja) → hanja.page_views (사설 스키마)
                    · gram             → gram.page_views   (사설 스키마)
                    · science          → 서버 기록 없음 (localStorage 만)
                    · cbt              → 서버 기록 없음
   ============================================================ */

window.PORTAL_SERVICES = [
  { key: 'hanja',    name: '한자야 놀자',  emoji: '漢', url: 'https://hanja.chatgpts.kr',   color: '#b45309', tracked: false },
  { key: 'voca',     name: '단어야 놀자',  emoji: '單', url: 'https://voca.chatgpts.kr',    color: '#4f46e5', tracked: true  },
  { key: 'history',  name: '역사야 놀자',  emoji: '史', url: 'https://history.chatgpts.kr', color: '#a16207', tracked: true  },
  { key: 'fortune',  name: '운세야 놀자',  emoji: '運', url: 'https://fortune.chatgpts.kr', color: '#7c3aed', tracked: true  },
  { key: 'mindtest', name: '마인드테스트', emoji: '心', url: 'https://mind.chatgpts.kr',    color: '#0d9488', tracked: true  },
  { key: 'work',     name: '워크야 놀자',  emoji: '職', url: 'https://work.chatgpts.kr',    color: '#475569', tracked: true  },
  { key: 'money',    name: '머니야 놀자',  emoji: '財', url: 'https://money.chatgpts.kr',   color: '#16a34a', tracked: true  },
  { key: 'tools',    name: '문서야 놀자',  emoji: '文', url: 'https://tools.chatgpts.kr',   color: '#0891b2', tracked: true  },
  { key: 'bible',    name: '성경아 놀자',  emoji: '聖', url: 'https://bible.chatgpts.kr',   color: '#6d28d9', tracked: true  },
  { key: 'maum',     name: '마음아 놀자',  emoji: '休', url: 'https://maum.chatgpts.kr',    color: '#059669', tracked: true  },
  { key: 'book',     name: '독서야 놀자',  emoji: '📚', url: 'https://book.chatgpts.kr',    color: '#ea580c', tracked: true  },
  { key: 'math',     name: '수학아 놀자',  emoji: '🔢', url: 'https://math.chatgpts.kr',    color: '#2563eb', tracked: true  },
  { key: 'gram',     name: '문법아 놀자',  emoji: '📝', url: 'https://gram.chatgpts.kr',    color: '#0d9488', tracked: false },
  { key: 'science',  name: '과학아 놀자',  emoji: '🔬', url: 'https://science.chatgpts.kr', color: '#7c3aed', tracked: false },
  { key: 'cbt',      name: '전기기사 CBT', emoji: '⚡', url: 'https://cbt.chatgpts.kr',     color: '#eab308', tracked: false }
];
