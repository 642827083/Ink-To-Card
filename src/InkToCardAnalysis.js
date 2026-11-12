var __INK_TO_CARD_ANALYSIS__ = (function () {
  // 直接分析已验证的普通笔，马克笔由解码入口排除；不经 SVG、图片解码或浏览器 Canvas。
  // 仍按最长边1024的近似可见面积投票，保留笔画覆盖顺序、透明度及最低量规则。
  var samples = [[0.25,0.25],[0.75,0.25],[0.25,0.75],[0.75,0.75]];
  var coverage = [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
  function analyze(encoded, length, settings) {
    var drawing = __INK_TO_CARD_DRAWING__.colors(encoded, length);
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,colors=[];
    var metadata={format:"PencilKit wrd",strokeCount:drawing.strokes.length,pointCount:drawing.pointCount,colors:colors,approximate:true};
    if (drawing.archive) metadata.archive=drawing.archive;
    if (drawing.excludedMarkerCount) metadata.excludedMarkerCount=drawing.excludedMarkerCount;
    // 全部为马克笔时返回空普通笔统计，由原生入口明确跳过，不能触发无彩色映射。
    if (!drawing.strokes.length && drawing.excludedMarkerCount) {
      return {histogram:InkToCardCore.histogram(new Uint8ClampedArray(4),1,1,settings),drawing:metadata};
    }
    drawing.strokes.forEach(function (stroke) {
      if (!stroke.alpha) return;
      if (colors.indexOf(stroke.color)<0) colors.push(stroke.color);
      stroke.points.forEach(function (p) {
        var r=p.width/2+1;
        minX=Math.min(minX,p.x-r);minY=Math.min(minY,p.y-r);
        maxX=Math.max(maxX,p.x+r);maxY=Math.max(maxY,p.y+r);
      });
    });
    if (!colors.length) throw new Error("绘图没有可见笔画");
    var width=maxX-minX,height=maxY-minY,scale=Math.min(1,1024/Math.max(width,height));
    if (!isFinite(width)||!isFinite(height)||width<=0||height<=0) throw new Error("绘图边界无效");
    var w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
    scale=Math.min(w/width,h/height);
    var dx=(w-width*scale)/2,dy=(h-height*scale)/2;
    var pixels=new Uint8ClampedArray(w*h*4),mask=new Uint8Array(w*h),work=0;
    drawing.strokes.forEach(function (stroke) {
      if (!stroke.alpha) return;
      var touched=[],total=0;
      stroke.points.forEach(function (p) {total+=p.width;});
      var radius=total/stroke.points.length*scale/2;
      var points=stroke.points.map(function (p) {return {x:(p.x-minX)*scale+dx,y:(p.y-minY)*scale+dy};});
      function segment(a,b) {
        var x0=Math.max(0,Math.floor(Math.min(a.x,b.x)-radius)),x1=Math.min(w-1,Math.ceil(Math.max(a.x,b.x)+radius));
        var y0=Math.max(0,Math.floor(Math.min(a.y,b.y)-radius)),y1=Math.min(h-1,Math.ceil(Math.max(a.y,b.y)+radius));
        var vx=b.x-a.x,vy=b.y-a.y,squared=vx*vx+vy*vy;
        for (var y=y0;y<=y1;y+=1) for (var x=x0;x<=x1;x+=1) {
          // 上限按实际检测次数计，异常的大跨度路径明确拒绝，不输出部分统计。
          if (++work>20000000) throw new Error("笔迹分析量过大，已保留原色；请拆分绘图后重试");
          var index=y*w+x,old=mask[index],bits=old;
          if (old===15) continue;
          for (var sample=0;sample<4;sample+=1) {
            if (bits&(1<<sample)) continue;
            var px=x+samples[sample][0],py=y+samples[sample][1];
            var t=squared?((px-a.x)*vx+(py-a.y)*vy)/squared:0;
            if (t<0) t=0; else if (t>1) t=1;
            var ex=px-a.x-t*vx,ey=py-a.y-t*vy;
            if (ex*ex+ey*ey<=radius*radius) bits|=1<<sample;
          }
          if (bits!==old) {
            if (!old) touched.push(index);
            mask[index]=bits;
          }
        }
      }
      if (points.length===1) segment(points[0],points[0]);
      else for (var p=1;p<points.length;p+=1) segment(points[p-1],points[p]);
      var red=parseInt(stroke.color.slice(1,3),16),green=parseInt(stroke.color.slice(3,5),16),blue=parseInt(stroke.color.slice(5,7),16);
      touched.forEach(function (index) {
        var at=index*4,alpha=stroke.alpha*coverage[mask[index]]/4,previous=pixels[at+3]/255;
        var combined=alpha+previous*(1-alpha),remaining=previous*(1-alpha);
        pixels[at]=(red*alpha+pixels[at]*remaining)/combined;
        pixels[at+1]=(green*alpha+pixels[at+1]*remaining)/combined;
        pixels[at+2]=(blue*alpha+pixels[at+2]*remaining)/combined;
        pixels[at+3]=combined*255;mask[index]=0;
      });
    });
    return {histogram:InkToCardCore.histogram(pixels,w,h,settings),drawing:metadata};
  }
  return { analyze: analyze };
})();
