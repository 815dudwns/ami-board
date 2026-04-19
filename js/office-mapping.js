/*
 * office-mapping.js — 구(區) → 사업소 자동 매핑
 *
 * 모듈 시스템 미사용 프로젝트 → window.OfficeMapping 노출
 */

window.OfficeMapping = (function () {

  var OFFICE_BY_GU = {
    '강북구': '강북성북지사',
    '성북구': '강북성북지사',
    '동대문구': '동대문중랑지사',
    '중랑구': '동대문중랑지사',
    '서대문구': '서대문은평지사',
    '은평구': '서대문은평지사',
    '종로구': '서울본부직할',
    '중구': '서울본부직할',
    '광진구': '광진성동지사',
    '성동구': '광진성동지사',
    '마포구': '마포용산지사',
    '용산구': '마포용산지사',
    '노원구': '노원도봉지사',
    '도봉구': '노원도봉지사'
  };

  var OFFICE_LIST = [
    '강북성북지사',
    '동대문중랑지사',
    '서대문은평지사',
    '서울본부직할',
    '광진성동지사',
    '마포용산지사',
    '노원도봉지사'
  ];

  /**
   * 주소 문자열에서 구(區)를 추출해 매핑된 사업소명 반환.
   * 매핑 없으면 null.
   */
  function officeFromAddress(address) {
    if (!address) return null;
    var m = address.match(/([가-힣]+구)/);
    return m ? (OFFICE_BY_GU[m[1]] || null) : null;
  }

  return {
    OFFICE_BY_GU: OFFICE_BY_GU,
    OFFICE_LIST: OFFICE_LIST,
    officeFromAddress: officeFromAddress
  };

})();
