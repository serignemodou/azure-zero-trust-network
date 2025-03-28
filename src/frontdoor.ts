import * as pulumi from "@pulumi/pulumi";
import * as network from "@pulumi/azure-native/network";
import * as cdn from "@pulumi/azure-native/cdn"

import { resourcesGroup, env, projectName, tags, location, projectConfig } from './common';
import {storageAccount, blobUri} from "./storageAccount";

interface frontDoorParams {
    sku: string,
    afdUriPrefix: string,
    afdUriSuffix: string
}

const fdParams = new pulumi.Config('frontDoor').requireObject<frontDoorParams>('params')

const profileName = `fd-${projectName}-${env}`
const profile = new cdn.Profile(profileName, {
    resourceGroupName: resourcesGroup.name,
    location: "global",
    profileName: profileName,
    sku: {
        name: fdParams.sku,
    },
    tags: tags
},
{
    dependsOn: storageAccount,
}
)

const endpointName = `fd-endpoint-${projectName}-${env}`
const fdEndpoint = new cdn.AFDEndpoint(endpointName, {
    resourceGroupName: resourcesGroup.name,
    location: 'global',
    endpointName: endpointName,
    profileName: profile.name,
    enabledState: cdn.EnabledState.Enabled,
    tags: tags
})

const cdnCustomDomain = env == 'prod' ? `cdn.beopenit.io` : `cdn.${env}.beopenit.io`
const afdCustomDomainName = `fd-custom-domain-${env}`
const afdCustomDomain = new cdn.AFDCustomDomain(afdCustomDomainName, {
    resourceGroupName: resourcesGroup.name,
    profileName: profile.name,
    hostName: cdnCustomDomain,
    customDomainName: afdCustomDomainName,
    tlsSettings: {
        certificateType: cdn.AfdCertificateType.ManagedCertificate,
        minimumTlsVersion: cdn.AfdMinimumTlsVersion.TLS12,
    }
})

const afdOriginGroupName = `fd-origin-group-${projectName}-${env}`
const afdOriginGroup = new cdn.AFDOriginGroup(afdOriginGroupName, {
    resourceGroupName: resourcesGroup.name,
    profileName: profile.name,
    originGroupName: afdOriginGroupName,
    sessionAffinityState: cdn.EnabledState.Enabled,
    loadBalancingSettings: {
        sampleSize: 4,
        successfulSamplesRequired: 3,
        additionalLatencyInMilliseconds: 50
    },
    healthProbeSettings: {
        probeIntervalInSeconds: 100,
        probePath: '/',
        probeProtocol: 'Http',
        probeRequestType: 'HEAD'
    }
})

const afdOriginName = `fd-origin-${projectName}-${env}`
const afdOrigin = new cdn.AFDOrigin(afdOriginName, {
    resourceGroupName: resourcesGroup.name,
    profileName: profile.name,
    originGroupName: afdOriginGroup.name,
    hostName: pulumi.interpolate`${storageAccount.name}.blob.core.windows.net`,
    originHostHeader: pulumi.interpolate`${storageAccount.name}.blob.core.windows.net`,
    httpPort: 80,
    httpsPort: 443,
    priority: 1,
    weight: 100,
    enabledState: cdn.EnabledState.Enabled,
    sharedPrivateLinkResource: {
        privateLink: {
            id: storageAccount.id,
        },
        groupId: 'blob',
        privateLinkLocation: location,
        requestMessage: 'Private link service from azure Front door',
    }
},
{
    dependsOn: afdOriginGroup,
})

const ruleSetName = `fd-rule-set`
const afRuleSet = new cdn.RuleSet(ruleSetName, {
    resourceGroupName: resourcesGroup.name,
    profileName: profile.name,
    ruleSetName: ruleSetName
})

const cacheBehavior = env != 'prod' ? 'BypassCache' : 'Override'
const ruleName1 = `fd-rule-${profileName}-${env}-1`
new cdn.Rule(ruleName1, {
    resourceGroupName: resourcesGroup.name,
    profileName: profile.name,
    ruleName: ruleName1,
    ruleSetName: afRuleSet.name,
    matchProcessingBehavior: cdn.MatchProcessingBehavior.Stop,
    order: 1,
    actions: [
        {
            name: 'UrlRewrite',
            parameters: {
                sourcePattern: '/',
                destination: blobUri,
                typeName: 'DeliveryRuleUrlRewriteActionParameters',
                preserveUnmatchedPath: false
            }
        },
        {
            name: 'RouteConfigurationOverride',
            parameters: {
                cacheBehavior: cacheBehavior,
                typeName: 'DeliveryRuleRouteConfigurationOverrideActionParameters'
            }
        }
    ],
    conditions: [
        {
            name: 'RequestScheme',
            parameters: {
                operator: cdn.Operator.Equal,
                matchValues: ['HTTPS'],
                typeName: 'DeliveryRuleRequestSchemeConditionParameters'
            }
        },
        {
            name: 'QueryString',
            parameters: {
                operator: cdn.Operator.RegEx,
                matchValues: ['^version=([0-9]).([0-9]).([0-9])$'],
                typeName: 'DeliveryRuleQueryStringConditionParameters'
            }
        }
    ]
})

const routeName = `afd-route-${projectName}-${env}`
new cdn.Route(routeName, {
    resourceGroupName: resourcesGroup.name,
    routeName: routeName,
    profileName: profile.name,
    endpointName: fdEndpoint.name,
    enabledState: cdn.EnabledState.Enabled,
    linkToDefaultDomain: cdn.LinkToDefaultDomain.Enabled,
    forwardingProtocol: cdn.ForwardingProtocol.MatchRequest,
    httpsRedirect: cdn.HttpsRedirect.Enabled,
    patternsToMatch: ['/*'],
    ruleSets: [
        {
            id: afRuleSet.id
        }
    ],
    originGroup: {
        id: afdOriginGroup.id,
    },
    customDomains: [
        {
            id: afdCustomDomain.id
        }
    ]
},
{
    dependsOn: afdOrigin,
})

const afdWafPolicyName = `afd-waf-policy-${projectName}-${env}`
const afdWafPolicy = new network.Policy(afdWafPolicyName, {
    resourceGroupName: resourcesGroup.name,
    location: 'global',
    policyName: afdWafPolicyName,
    sku: {
        name: fdParams.sku,
    },
    policySettings: {
        enabledState: cdn.EnabledState.Enabled,
        mode: cdn.PolicyMode.Prevention
    },
    managedRules: {
        managedRuleSets: [
            {
                ruleSetType: 'Microsoft_DefaultRuleSet',
                ruleSetVersion: '2.1',
                ruleSetAction: 'Block'
            },
            {
                ruleSetType: 'Microsoft_BotManagerRuleSet',
                ruleSetVersion: '1.1',
                ruleSetAction: 'Block'
            }
        ]
    },
    customRules: {
        rules: [
            {
                name: 'AllowOnlyOrganizationIP',
                action: 'Block',
                priority: 100,
                ruleType: 'MatchRule',
                matchConditions: [
                    {
                        matchVariable: 'SocketAddr',
                        operator: 'IPMatch',
                        negateCondition: true,
                        matchValue: ['0.0.0.0/0'] //Only Allow IP CIDR
                    }
                ]
            }
        ]
    },
    tags: tags,
})

const afdWafSecurityPolicyName = `afd-security-policy-${projectName}-${env}`
new cdn.SecurityPolicy(afdWafSecurityPolicyName, {
    securityPolicyName: afdWafSecurityPolicyName,
    resourceGroupName: resourcesGroup.name,
    profileName: profile.name,
    parameters: {
        type: 'WebApplicationFirewall',
        wafPolicy: {
            id: afdWafPolicy.id
        },
        associations: [
            {
                domains: [
                    {
                        id: fdEndpoint.id
                    },
                    {
                        id: afdCustomDomain.id
                    }
                ],
                patternsToMatch: ['/*']
            }
        ]
    }
})

const afdURL: pulumi.Input<string> = pulumi.interpolate`${fdParams.afdUriPrefix}/${resourcesGroup.name}/${fdParams.afdUriSuffix}/${profile.name}`