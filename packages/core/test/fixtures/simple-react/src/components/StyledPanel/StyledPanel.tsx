import styled from 'styled-components';

/**
 * A styled factory exported DIRECTLY as the default. ts-morph hands the tagged
 * template itself back as the exported declaration — there is no variable
 * declaration to look inside — so a body dispatch that only inspects variable
 * initializers dropped this shape from discovery entirely.
 */
export default styled.section`
  display: block;
  padding: 16px;
  border-radius: 8px;
  background: #f5f3ff;
`;
