// Service Worker：离线缓存 + 桌面小组件数据更新
var CACHE_NAME = "daily-plan-v2";
var SECRET_CACHE = "plan-secret";
var SUPA_URL = "https://expptauxhthhydkznbba.supabase.co";
var PLANS_API = SUPA_URL + "/rest/v1/plans?select=plan_date,tasks&secret=eq.";

var ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./widget-data.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png"
];

// ===== 日期工具 =====
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function toKey(d) { return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
function addDays(key, n) {
  var parts = key.split("-");
  var d = new Date(+parts[0], +parts[1]-1, +parts[2]);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

// ===== 安装/激活 =====
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) {
          return k !== CACHE_NAME && k !== SECRET_CACHE;
        }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// ===== 静态资源缓存（云端 API 不缓存） =====
self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.hostname.indexOf("supabase") !== -1) return;

  event.respondWith(
    caches.match(event.request).then(function (hit) {
      if (hit) return hit;
      return fetch(event.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        return res;
      }).catch(function () { return caches.match("./index.html"); });
    })
  );
});

// ===== 接收页面发来的密码并持久化 =====
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "secret") {
    caches.open(SECRET_CACHE).then(function (cache) {
      cache.put("secret", new Response(event.data.pwd));
    });
  }
});

function getSecret() {
  return caches.open(SECRET_CACHE).then(function (cache) {
    return cache.match("secret").then(function (res) {
      return res ? res.text() : null;
    });
  });
}

// ===== 构建小组件 UI：Overdue / Today / Tomorrow / 未来日期 =====
function buildWidgetData(rows) {
  var today = toKey(new Date());
  var tomorrow = addDays(today, 1);
  var buckets = {};
  var order = [];

  for (var i = 0; i < rows.length; i++) {
    var day = rows[i].plan_date;
    var groupName;
    if (day < today) groupName = "Overdue";
    else if (day === today) groupName = "Today";
    else if (day === tomorrow) groupName = "Tomorrow";
    else groupName = day;

    for (var j = 0; j < rows[i].tasks.length; j++) {
      var t = rows[i].tasks[j];
      if (t.done) continue;
      if (!buckets[groupName]) {
        buckets[groupName] = [];
        order.push(groupName);
      }
      buckets[groupName].push(t.text);
    }
  }

  var groups = [];
  if (order.length === 0) {
    groups.push({ columns: [ { type: "text", value: "🎉 所有计划都完成了" } ] });
  } else {
    for (var g = 0; g < order.length; g++) {
      var name = order[g];
      var columns = [ { type: "text", value: name } ];
      var items = buckets[name].slice(0, 8);
      for (var k = 0; k < items.length; k++) {
        columns.push({ type: "text", value: "☐ " + items[k] });
      }
      groups.push({ columns: columns });
    }
  }
  return { ui: { type: "v2", groups: groups } };
}

// ===== 小组件事件 =====
function updateWidget(widget) {
  return getSecret().then(function (pwd) {
    if (!pwd) {
      return widget.update({ ui: { type: "v2", groups: [
        { columns: [ { type: "text", value: "请先打开网页登录" } ] }
      ]}});
    }
    return fetch(PLANS_API + encodeURIComponent(pwd))
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then(function (rows) { return widget.update(buildWidgetData(rows)); })
      .catch(function () {});
  });
}

self.addEventListener("widgetinstall", function (event) {
  event.waitUntil(updateWidget(event.widget));
});

self.addEventListener("widgetupdate", function (event) {
  event.waitUntil(updateWidget(event.widget));
});

self.addEventListener("widgetclick", function (event) {
  // 点击小组件打开 PWA
  if (event.action === "open-app") {
    event.waitUntil(self.clients.matchAll({ type: "window" }).then(function (list) {
      if (list.length > 0) return list[0].focus();
      return self.clients.openWindow("./");
    }));
  }
});
