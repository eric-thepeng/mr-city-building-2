using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SupportBeam : MonoBehaviour
{
    [SerializeField] private Transform beamBody;
    private float distance = 0;
    private float maxDistance = 0;

    private int bigNumber = 10000;

    public void SetUp(float maxDistance)
    {
        this.maxDistance = maxDistance;
        ResetBeam(0.02f);
    }
    
    public float CalculateSupportBeam()
    {
        distance = GetDistanceToGround();
        AdjustSupportingBeam(distance);
        if (distance > maxDistance) return -1;
        return distance;
    }

    public void ResetBeam(float targetDistance = 0f)
    {
        distance = 0;
        AdjustSupportingBeam(distance);
    }
    
    public float GetDistanceToGround()
    {
        // Cast a ray from the targetTransform's position downward
        Ray ray = new Ray(transform.position, Vector3.down);

        // Create a RaycastHit variable to store information about the hit
        RaycastHit hit;
        

        // Perform the raycast
        if (Physics.Raycast(ray, out hit, maxDistance))
        {
            // Calculate the distance to the ground collider
            float distanceToGround = hit.distance;
            if (distanceToGround > bigNumber) distanceToGround = bigNumber;
            return distanceToGround;
        }

        // If the raycast doesn't hit anything, return a large value to indicate no ground found.
        return Mathf.Infinity;
    }

    public void AdjustSupportingBeam(float height)
    {
        if (height > maxDistance) height = maxDistance;
        float worldLength = height * 10 / 4;
        beamBody.transform.localScale =
            new Vector3(beamBody.transform.localScale.x, worldLength / 2, beamBody.transform.localScale.z);
        beamBody.transform.localPosition =
            new Vector3(beamBody.transform.localPosition.x, -worldLength / 2, beamBody.transform.localPosition.z);
        if (height == maxDistance)
        {
            // highlight it
        }
    }
}
