import * as parse5 from 'parse5'
import * as React from 'react'

import Component from './component'
import css2obj from './css2obj'
import { evaluateExpression } from './eval'
import {
  componentDataAttribute,
  INCLUDE_PREFIX,
  ObjectStringToString,
  ReactAttributes,
  State
} from './types'
import { toReactAttributeName } from './utils'
import workspace from './workspace'

const renderComponent = (
  info: Component,
  state: State,
  rootNodeProperties: React.CSSProperties | null,
  components: Set<string>,
  errorHandler: (component: string, position: monaco.Position, text: string) => void,
  componentKey: string | number | null
): React.ReactNode => {
  components.add(info.name)
  const renderNode = (
    data: {},
    node: parse5.AST.Default.Node,
    key: string | number | null,
    additionalStyles: React.CSSProperties | null,
    additionalDataAttribute: string | null,
    isRoot: boolean
  ): React.ReactNode => {
    const nodeCounter = node as any
    nodeCounter.visits = (nodeCounter.visits || 0) + 1
    const locationJSON = (location: parse5.MarkupData.ElementLocation) =>
      JSON.stringify({
        cmp: info.name,
        ln: location.line,
        c: location.col,
        eln: location.endTag !== undefined ? location.endTag.line : location.line,
        ec: location.endTag !== undefined ? location.endTag.col : location.col
      })
    try {
      if (node.nodeName === '#text') {
        const textNode = node as parse5.AST.Default.TextNode
        return textNode.value.replace(/{([^}]+)?}/g, str => {
          return evaluateExpression(str.substring(1, str.length - 1), data)
        })
      }
      const element = node as parse5.AST.Default.Element
      if (!element.childNodes) return undefined
      const ifs = element.attrs.find(attr => attr.name === '@if')
      if (ifs) {
        const result = evaluateExpression(ifs.value, data)
        if (!result) {
          nodeCounter.visits--
          return undefined
        }
      }
      const loop = element.attrs.find(attr => attr.name === '@loop')
      const as = element.attrs.find(attr => attr.name === '@as')
      if (loop && as) {
        const collection = evaluateExpression(loop.value, data) as any[]
        if (!Array.isArray(collection)) {
          throw new Error('Trying to loop a non-array')
        }
        if (collection.length === 0) {
          nodeCounter.visits--
          return undefined
        }
        const template = Object.assign({}, node, {
          attrs: element.attrs.filter(attr => !attr.name.startsWith('@'))
        })
        return collection.map((obj, i) =>
          renderNode(
            Object.assign({}, data, { [as.value]: obj }),
            template,
            i,
            null,
            additionalDataAttribute,
            false
          )
        )
      }
      if (node.nodeName.startsWith(INCLUDE_PREFIX)) {
        const componentName = node.nodeName.substring(INCLUDE_PREFIX.length)
        const componentInfo = workspace.getComponent(componentName)
        const props = element.attrs.reduce(
          (elementProps, attr) => {
            if (attr.name.startsWith(':')) {
              const name = attr.name.substring(1)
              const expression = attr.value
              elementProps[name] = evaluateExpression(expression, data)
            } else {
              // TODO: convert to type
              elementProps[attr.name] = attr.value
            }
            return elementProps
          },
          {} as any
        )
        // TODO: validate props
        const componentState: State = {
          name: 'Included',
          props
        }
        // TODO: key?
        return renderComponent(componentInfo, componentState, null, components, errorHandler, key)
      }
      const attrs: ReactAttributes = element.attrs
        .filter(attr => !attr.name.startsWith(':') && !attr.name.startsWith('@'))
        .reduce(
          (obj, attr) => {
            const name = toReactAttributeName(attr.name)
            if (name) {
              obj[name] = attr.value
            }
            return obj
          },
          {} as ObjectStringToString
        )
      if (key !== null) {
        attrs.key = String(key)
      }
      element.attrs.forEach(attr => {
        if (!attr.name.startsWith(':')) return
        const name = attr.name.substring(1)
        const expression = attr.value
        const fname = toReactAttributeName(name)
        if (fname) {
          attrs[fname] = evaluateExpression(expression, data)
          // TODO if attrs.style is dynamic it MUST be an object
        }
      })
      if (attrs.style && typeof attrs.style === 'string') {
        attrs.style = css2obj(attrs.style)
      }
      const location = element.__location
      if (location) {
        attrs['data-location'] = locationJSON(location)
      }
      attrs.style = Object.assign({}, attrs.style || {}, additionalStyles)
      if (isRoot) {
        attrs['data-unicycle-component-root'] = ''
      }
      if (additionalDataAttribute) {
        attrs[additionalDataAttribute] = ''
      }
      const childNodes = element.childNodes.map((childNode, i) =>
        renderNode(data, childNode, i, null, additionalDataAttribute, false)
      )
      return React.createElement.apply(
        null,
        new Array<any>(node.nodeName, attrs).concat(childNodes)
      )
    } catch (err) {
      const element = node as parse5.AST.Default.Element
      if (node && element.__location) {
        errorHandler(
          info.name,
          new monaco.Position(element.__location.line, element.__location.col),
          err.message
        )
      }
      return (
        <span
          style={{
            all: 'initial',
            fontFamily: 'sans-serif',
            display: 'inline-block',
            color: '#444',
            backgroundColor: '#FAE1E1',
            padding: '3px 10px',
            fontSize: 14,
            fontWeight: 'bold'
          }}
          data-location={element.__location && locationJSON(element.__location)}
        >
          <span style={{ color: '#c23030' }}>Error:</span> {err.message}
        </span>
      )
    }
  }
  const rootNode = info.markup.getRootNode()
  // Make all root properties in all states available even if they are not defined
  // This way you can do @if="rootVarThatIsNotInAllStates"
  const initialData = info.data.getStates().reduce((obj, st) => {
    for (const prop of Object.keys(st.props)) {
      obj[prop] = undefined
    }
    return obj
  }, {} as any)
  Object.assign(initialData, state.props)

  return renderNode(
    initialData,
    rootNode,
    componentKey,
    rootNodeProperties,
    componentDataAttribute(info.name),
    true
  )
}

export default renderComponent
