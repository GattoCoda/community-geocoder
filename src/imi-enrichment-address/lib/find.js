import util from './util'

// tree の構造変更
const tree = (function(src) {

  const map = {}
  const moved = {}

  const dig = function(src) {
    const list = []

    Object.keys(src).forEach(key => {
      const val = src[key]
      const obj = {
        code: key.match(/^[0-9]+/)[0],
        label: key.replace(/^[0-9]+/, ''),
      }

      if (typeof val === 'object') {
        obj.children = dig(val).map(child => {
          child.parent = obj
          if (child.code.length !== 5) {
            child.code = obj.code + child.code
          }
          return child
        })
      } else if (typeof val === 'number') {
        obj.chome = val
      } else if (typeof val === 'string') {
        moved[key] = val
      }

      if (obj.code.length === 5) map[key] = obj

      list.push(obj)
    })

    return list
  }
  const root = dig(src)

  Object.keys(moved).forEach(from => {
    map[from].next = map[moved[from]]
  })

  return root

})(require('./tree.json'))


// 1. 市区町村の特定
// 2-1. n=1 の場合: 下位地名の探索
// 2-2. n>1 の場合: 下位地名の探索> 絞り込み
// 2-3. n=0 の場合: ユニーク下位地名の探索

const upper = (function() {
  const map = {}
  const dig = function(list) {
    list.forEach(focus => {
      if (focus.code.length === 5) {
        const s = [focus.label]
        for (let f = focus.parent; f; f = f.parent) {
          s.forEach(t => {
            s.push(f.label + t)
          })
        }
        s.forEach(x => {
          if (typeof map[x] === 'undefined') map[x] = []
          map[x].push(focus)
        })
      }
      if (focus.children) dig(focus.children)
    })
  }
  dig(tree)

  // 名前が同じでコードだけが違うパターンでは最新のものだけを残す
  const fullname = e => (e.parent ? fullname(e.parent) : '') + e.label
  Object.keys(map).forEach(key => {
    const list = map[key]
    map[key] = list.filter(a => {
      if (typeof a.next === 'undefined') return true
      if (list.find(b => a !== b && a.next === b && fullname(a) === fullname(b))) return false
      return true
    })
  })

  return map
})()

const lower = (function() {

  const map = {}

  const dig = function(list) {
    list.forEach(focus => {
      if (typeof focus.children !== 'undefined') {
        dig(focus.children)
      }
      if (typeof focus.chome !== 'undefined') {
        if (typeof map[focus.label] === 'undefined') map[focus.label] = []
        map[focus.label].push(focus)
      }
    })
  }
  dig(tree)

  Object.keys(map).forEach(key => {
    if (map[key].length === 1) map[key] = map[key][0]
    else delete map[key]
  })

  return map
})()

const find = address => {

  let normalized = util.simplify(address).trim()
  normalized = normalized.replace(/\s/g, '')
  if (normalized.match(/^(.+[都道府県])(.+[郡])(.+[町村].*)$/)) {
    normalized = RegExp.$1 + RegExp.$3
  } else if (normalized.match(/^(.+[郡])(.+[町村].*)$/)) {
    normalized = RegExp.$2
  }

  // 正解と末尾をもとに丁目コードを追加して返す
  const fix = function(hit, tail) {
    if (hit.chome > 0) {
      if (!tail.trim().match(/^[0-9０-９一二三四五六七八九十〇]+/)) {
        return {
          code: hit.code,
          tail: tail,
          expectedChome: hit.chome,
          actualChome: null,
        }
      }
      let chome = tail.trim().match(/^[0-9０-９一二三四五六七八九十〇]+/)[0]
      let rest = tail.trim().substring(chome.length)
      chome = util.k2h(util.z2h(chome))
      if (chome.match(/^([0-9]+)$/)) {
        while (chome.length < 3) chome = '0' + chome
        rest = rest.replace(/^(丁目|-)/, '')
        if (hit.chome < parseInt(chome)) return {
          code: hit.code,
          tail: rest,
          expectedChome: hit.chome,
          actualChome: parseInt(chome),
        }
        return {
          code: hit.code + chome,
          tail: rest,
        }
      }
    }
    return {
      code: hit.code + (hit.code.length === 9 ? '000' : ''),
      tail: tail,
    }
  }

  // 市区町村にヒットする場合
  for (let i = normalized.length; i >= 0; i--) {
    const head = normalized.substring(0, i)
    const answer = upper[head]
    if (typeof answer !== 'undefined') {
      if (answer.length > 1) {
        return {
          multipleChoice: true,
        }
      }

      // 京都の「通り名」に対する処理
      // `丁目` が `tree.json` にある場合バグるかも
      if (5 === answer[0].code.length && answer[0].code.startsWith('26') && normalized.substring(i)) {
        const result = { code: '', tail: '' }
        let theIndex = 0
        for (let k = 0; k < answer[0].children.length; k++) {
          const item = answer[0].children[k]
          const index = normalized.substring(i).lastIndexOf(item.label)

          // もっとも後ろでマッチする町名が正しい町名それ以前は「通り名」
          // See https://github.com/geolonia/community-geocoder/issues/10
          if (index >= theIndex) {
            theIndex = index
            const parts = normalized.substring(i).split(item.label)
            result.code = `${item.code}${( Array(3).join('0') + item.chome ).slice( -3 )}`
            result.tail = parts[parts.length - 1]
          }
        }

        if (result.code) {
          return result
        }
      }

      let latest = answer[0]
      while (latest.next) latest = latest.next
      for (let j = normalized.length; j > i; j--) {
        const body = normalized.substring(i, j)
        const tail = normalized.substring(j).trim()
        const hit = latest.children.find(child => {
          return body.replace(/^大字/, '').replace(/^字/, '') === child.label.replace(/^大字/, '').replace(/^字/, '')
        })
        if (typeof hit !== 'undefined') {
          return fix(hit, tail)
        }
      }

      return {
        code: answer[0].code,
        tail: normalized.substring(i),
      }
    }
  }

  // 市区町村にヒットしない場合
  for (let i = normalized.length; i >= 0; i--) {
    const head = normalized.substring(0, i)
    const hit = lower[head]
    if (typeof hit !== 'undefined') {
      const tail = normalized.substring(i).trim()
      return fix(hit, tail)
    }
  }

  return null
}

export default find
