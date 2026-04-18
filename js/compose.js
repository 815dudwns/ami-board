/*
 * compose(imageFile, boardData) → Promise<Blob>
 *
 * boardData: {
 *   projectName, office, workplace, content, workers, workDate
 * }
 *
 * EXIF 주의: iPhone 사진은 EXIF orientation을 포함.
 * createImageBitmap에 { imageOrientation: 'from-image' } 전달로 처리.
 * 미지원 브라우저(구형 Android)는 <img> 요소 경유 폴백.
 */

var Compose = (function () {
  var FONT_FAMILY = '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif';

  var TABLE_ROWS = [
    { label: '공사명', key: 'projectName' },
    { label: '사업소', key: 'office' },
    { label: '작업장소', key: 'workplace' },
    { label: '내용', key: 'content' },
    { label: '작업원', key: 'workers' },
    { label: '작업일자', key: 'workDate' }
  ];

  function loadFonts() {
    if (!document.fonts || !document.fonts.load) {
      return Promise.resolve();
    }
    return Promise.all([
      document.fonts.load('bold 32px "Noto Sans KR"'),
      document.fonts.load('24px "Noto Sans KR"')
    ]).then(function () {
      return document.fonts.ready;
    });
  }

  function loadImageBitmap(file) {
    if (typeof createImageBitmap !== 'undefined') {
      return createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    // 폴백: img 요소 경유
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('이미지 로드 실패'));
      };
      img.src = url;
    });
  }

  function compose(imageFile, boardData) {
    return loadFonts().then(function () {
      return loadImageBitmap(imageFile);
    }).then(function (bitmap) {
      var W = bitmap.width || bitmap.naturalWidth;
      var H = bitmap.height || bitmap.naturalHeight;

      var canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext('2d');

      ctx.drawImage(bitmap, 0, 0, W, H);
      if (bitmap.close) bitmap.close();

      drawTable(ctx, W, H, boardData);

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('Blob 생성 실패'));
        }, 'image/jpeg', 0.9);
      });
    });
  }

  function drawTable(ctx, imgW, imgH, data) {
    // 표 너비: 긴 쪽 기준 55%
    var longerSide = Math.max(imgW, imgH);
    var scale = longerSide / 1920;
    var tableW = Math.round(imgW * 0.55);

    // 폰트/패딩 크기를 scale에 맞춤 (최소 10px 보장)
    var fontSize = Math.max(10, Math.round(22 * scale));
    var labelFontSize = Math.max(9, Math.round(18 * scale));
    var padding = Math.max(6, Math.round(10 * scale));
    var rowH = Math.max(20, Math.round(34 * scale));
    var labelColW = Math.round(tableW * 0.28);

    var tableH = rowH * TABLE_ROWS.length;
    var margin = Math.max(8, Math.round(16 * scale));

    var tableX = margin;
    var tableY = imgH - tableH - margin;

    // 반투명 흰 배경
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(tableX, tableY, tableW, tableH);

    // 테두리
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, Math.round(1.5 * scale));
    ctx.strokeRect(tableX, tableY, tableW, tableH);

    TABLE_ROWS.forEach(function (row, i) {
      var rowY = tableY + rowH * i;
      var value = (data[row.key] || '').toString();

      // 행 구분선 (첫 행 제외)
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(tableX, rowY);
        ctx.lineTo(tableX + tableW, rowY);
        ctx.stroke();
      }

      // 라벨/값 열 구분선
      ctx.beginPath();
      ctx.moveTo(tableX + labelColW, rowY);
      ctx.lineTo(tableX + labelColW, rowY + rowH);
      ctx.stroke();

      // 라벨
      ctx.fillStyle = '#222222';
      ctx.font = 'bold ' + labelFontSize + 'px ' + FONT_FAMILY;
      ctx.textBaseline = 'middle';
      ctx.fillText(
        row.label,
        tableX + padding,
        rowY + rowH / 2
      );

      // 값 (길면 잘라서 표시)
      ctx.font = fontSize + 'px ' + FONT_FAMILY;
      var maxValW = tableW - labelColW - padding * 2;
      var displayVal = truncateText(ctx, value, maxValW);
      ctx.fillText(
        displayVal,
        tableX + labelColW + padding,
        rowY + rowH / 2
      );
    });
  }

  function truncateText(ctx, text, maxWidth) {
    if (!text) return '';
    var measured = ctx.measureText(text).width;
    if (measured <= maxWidth) return text;
    var ellipsis = '...';
    var ellW = ctx.measureText(ellipsis).width;
    var truncated = text;
    while (truncated.length > 0 && ctx.measureText(truncated).width + ellW > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + ellipsis;
  }

  return {
    compose: compose
  };
})();
